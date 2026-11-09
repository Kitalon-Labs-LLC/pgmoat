// Baseline for the pgmoat technical report: "a read-only database role alone".
//
// Sends every query of a case set straight to Postgres as the least-privilege role pgmoat_reader,
// with no pgmoat in front, and scores it against that set's expectations.
// Each case runs in its own throwaway copy of the seeded database.
//
// Case sets (--set):
//   corpus   the 321-case corpus in packages/core/test/corpus/cases/ (default)
//   heldout  the 80 held-out cases in packages/core/test/heldout/cases.yaml
//
// Scoring:
//   expected refused -> correct only if Postgres refuses it (any error). Success, or running until the timeout, counts as a miss.
//   expected allowed -> correct unless Postgres refuses for a security reason (SQLSTATE 42501 or 25006).
//                       Type errors in the seed data (e.g. uuid = integer) are not the role's fault and count as correct.
// A miss is not always a leak: Postgres does not run a CTE the query never reads, so such a case
// runs without returning the hidden data. The case still counts as a miss, because the role did
// not refuse it.
//
// Postgres version: the role baseline is meant for 15 or newer. Before 15, every role may CREATE in
// schema public, so on 14 (or on a database upgraded from 14 that kept that grant) the role also
// lets CREATE TABLE/VIEW/FUNCTION and SELECT INTO through.
// Recorded results for Postgres 14 to 18 are in tools/baseline-results/, and CI reruns them.
//
// Setup (once): start a Postgres server, then run the repo's fixtures as a superuser:
//   psql -d testdb -f packages/core/test/integration/harness/seed.sql
//   psql -d testdb -f packages/core/test/integration/harness/roles.sql
//   psql -d testdb -f packages/core/test/integration/harness/rls.sql
//
// Run:  node tools/readonly-role-baseline.mjs . [out.json] [--set corpus|heldout]   (from the repo root, after pnpm install)
// Env:  PGHOST (default 127.0.0.1), PGPORT (default 5433), PGSUPER (default postgres), PGTEMPLATE (default testdb)
//       Roles must be able to log in without a password (trust auth), or set PGPASSWORD_READER.
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const setFlag = args.indexOf('--set');
const set = setFlag === -1 ? 'corpus' : args[setFlag + 1];
const positional = args.filter((_, i) => i !== setFlag && i !== setFlag + 1);
const repo = positional[0] && resolve(positional[0]);
const outPath = positional[1] ?? 'baseline-results.json';
if (!repo || !['corpus', 'heldout'].includes(set))
  throw new Error(
    'usage: node readonly-role-baseline.mjs <repoRoot> [out.json] [--set corpus|heldout]',
  );

const require = createRequire(join(repo, 'packages/core/package.json'));
const pg = require('pg');
const { parse } = require('yaml');

const host = process.env.PGHOST ?? '127.0.0.1';
const port = Number(process.env.PGPORT ?? 5433);
const superUser = process.env.PGSUPER ?? 'postgres';
const template = process.env.PGTEMPLATE ?? 'testdb';
const TENANT = 'a0000000-0000-0000-0000-000000000001'; // same tenant the repo's DB-mode corpus test uses
const SECURITY_ERRORS = new Set(['42501', '25006']); // insufficient_privilege, read_only_sql_transaction

// Each set is normalized to { id, group, expect, refuse, sql }. `expect` keeps the set's own form:
// the expected PGM- code (or 'allowed') for the corpus, 'refused' or 'allowed' for the held-out set.
const SETS = {
  corpus: {
    load() {
      const dir = join(repo, 'packages/core/test/corpus/cases');
      return readdirSync(dir)
        .filter((f) => f.endsWith('.yaml'))
        .sort()
        .flatMap((f) => parse(readFileSync(join(dir, f), 'utf8')))
        .map((c) => ({
          id: c.id,
          group: c.group,
          expect: c.expect.refused ?? 'allowed',
          refuse: c.expect.refused !== undefined,
          sql: c.sql,
        }));
    },
    labels: {
      statements: 'Write statements',
      locking: 'Row locks and SELECT INTO',
      cte: 'CTEs that write data',
      stacking: 'Stacked statements',
      functions: 'Forbidden functions',
      'sql-exec': 'Functions that run other SQL',
      policy: 'Hidden tables and columns',
      explain: 'EXPLAIN',
      budgets: 'Row budgets',
      edge: 'Parser edge cases',
      allowed: 'Legitimate queries',
    },
    hiddenGroup: 'policy',
    notRoleJob: ['budgets', 'edge', 'explain'],
    // pnpm test:corpus requires every corpus case to pass, so pgmoat's column is the full count.
    pgmoatCorrect: () => null,
  },
  heldout: {
    load() {
      const file = join(repo, 'packages/core/test/heldout/cases.yaml');
      return parse(readFileSync(file, 'utf8')).map((c) => ({
        id: c.id,
        group: c.category,
        expect: c.expect,
        refuse: c.expect === 'refused',
        sql: c.sql,
      }));
    },
    labels: {
      writes: 'Writes, schema changes and session control',
      stacking: 'Stacked statements',
      functions: 'Functions with side effects or file access',
      'sql-exec': 'Functions that run other SQL',
      hidden: 'Hidden tables and columns',
      budgets: 'Row budgets',
      explain: 'EXPLAIN',
      legit: 'Legitimate queries',
    },
    hiddenGroup: 'hidden',
    notRoleJob: ['budgets', 'explain'],
    // The held-out set is a measurement, so pgmoat's column comes from its recorded run.
    pgmoatCorrect() {
      const file = join(repo, 'packages/core/test/heldout/results.json');
      if (!existsSync(file)) return null;
      const byId = new Map(
        JSON.parse(readFileSync(file, 'utf8')).map((r) => [r.id, r.correct]),
      );
      return (id) => byId.get(id) === true;
    },
  },
};

const spec = SETS[set];
const cases = spec.load();

const admin = new pg.Client({
  host,
  port,
  user: superUser,
  database: 'postgres',
});
await admin.connect();

async function runRaw(sql, db) {
  const c = new pg.Client({
    host,
    port,
    user: 'pgmoat_reader',
    password: process.env.PGPASSWORD_READER,
    database: db,
  });
  await c.connect();
  try {
    await c.query(`SET statement_timeout = '3s'`);
    await c.query(`SET lock_timeout = '1s'`);
    await c.query(`SET app.tenant_id = '${TENANT}'`);
    try {
      await c.query(sql); // simple protocol: stacked statements are accepted, like a naive MCP server
      return { outcome: 'ran' };
    } catch (e) {
      if (e.code === '57014')
        return { outcome: 'ran', note: 'ran until statement_timeout' };
      return {
        outcome: 'error',
        code: e.code,
        message: String(e.message).slice(0, 160),
      };
    }
  } finally {
    await c.end().catch(() => {});
  }
}

const rows = [];
let n = 0;
for (const tc of cases) {
  n += 1;
  const db = `bl_${n}`;
  await admin.query(`CREATE DATABASE ${db} TEMPLATE ${template}`);
  try {
    const r = await runRaw(tc.sql, db);
    r.correct = tc.refuse
      ? r.outcome === 'error'
      : r.outcome === 'ran' || !SECURITY_ERRORS.has(r.code);
    rows.push({
      id: tc.id,
      group: tc.group,
      expect: tc.expect,
      sql: tc.sql,
      ...r,
    });
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  }
}
const { rows: versionRows } = await admin.query('SHOW server_version');
await admin.end();
writeFileSync(outPath, JSON.stringify(rows, null, 1));

const pgmoatOk = spec.pgmoatCorrect();
const pct = (a, b) => `${((100 * a) / b).toFixed(1)}%`;
console.log(
  `Set: ${set} (${rows.length} cases), Postgres ${versionRows[0].server_version}\n`,
);
console.log('| Category | Queries | Read-only role alone | pgmoat |');
console.log('|---|---|---|---|');
let tot = 0,
  ok = 0,
  pgOk = 0;
for (const g of Object.keys(spec.labels)) {
  const rs = rows.filter((r) => r.group === g);
  const c = rs.filter((r) => r.correct).length;
  const p = pgmoatOk ? rs.filter((r) => pgmoatOk(r.id)).length : rs.length;
  tot += rs.length;
  ok += c;
  pgOk += p;
  console.log(
    `| ${spec.labels[g]} | ${rs.length} | ${c} / ${rs.length} | ${p} / ${rs.length} |`,
  );
}
const unlabeled = rows.filter((r) => !(r.group in spec.labels));
if (unlabeled.length)
  throw new Error(
    `cases with an unknown category: ${unlabeled.map((r) => r.id).join(', ')}`,
  );
console.log(
  `| Total | ${tot} | ${ok} / ${tot} (${pct(ok, tot)}) | ${pgOk} / ${tot} |`,
);

// Subtotal without the groups that a database role is not designed to enforce.
const core = rows.filter((r) => !spec.notRoleJob.includes(r.group));
const coreOk = core.filter((r) => r.correct).length;
console.log(
  `\nExcluding ${spec.notRoleJob.map((g) => spec.labels[g]).join(', ')}: ${coreOk} / ${core.length} (${pct(coreOk, core.length)})`,
);

const unsafe = rows.filter((r) => r.expect !== 'allowed');
const legit = rows.filter((r) => r.expect === 'allowed');
console.log(
  `Unsafe blocked: ${unsafe.filter((r) => r.correct).length} / ${unsafe.length}; legitimate allowed: ${legit.filter((r) => r.correct).length} / ${legit.length}`,
);

const blockedHidden = rows.filter(
  (r) => r.group === spec.hiddenGroup && r.expect !== 'allowed' && r.correct,
);
const leaks = blockedHidden.filter((r) =>
  (r.message ?? '').includes('permission denied'),
);
console.log(
  `Blocked hidden-object cases that answer "permission denied" (confirms the object exists): ${leaks.length} / ${blockedHidden.length}`,
);
