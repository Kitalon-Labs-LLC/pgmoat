// Baseline for the pgmoat paper: "a read-only database role alone".
//
// Sends every corpus query (all 321) straight to Postgres as the least-privilege role pgmoat_reader,
// with no pgmoat in front, and scores it against the corpus expectations.
// Each case runs in its own throwaway copy of the seeded database.
//
// Scoring:
//   expected refused -> correct only if Postgres refuses it (any error). Success, or running until the timeout, counts as a miss.
//   expected allowed -> correct unless Postgres refuses for a security reason (SQLSTATE 42501 or 25006).
//                       Type errors in the seed data (e.g. uuid = integer) are not the role's fault and count as correct.
//
// Postgres version: use 15 or newer. Before 15, every role may CREATE in schema public, so on 14
// (or on a database upgraded from 14 that kept that grant) the role also lets CREATE TABLE/VIEW/FUNCTION
// and SELECT INTO through, and scores 262 instead of 266.
//
// Setup (once): start a Postgres 15+ server, then run the repo's fixtures as a superuser:
//   psql -d testdb -f packages/core/test/integration/harness/seed.sql
//   psql -d testdb -f packages/core/test/integration/harness/roles.sql
//   psql -d testdb -f packages/core/test/integration/harness/rls.sql
//
// Run:  node tools/readonly-role-baseline.mjs . [out.json]      (from the repo root, after pnpm install)
// Env:  PGHOST (default 127.0.0.1), PGPORT (default 5433), PGSUPER (default postgres), PGTEMPLATE (default testdb)
//       Roles must be able to log in without a password (trust auth), or set PGPASSWORD_READER.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.argv[2];
const outPath = process.argv[3] ?? 'baseline-results.json';
if (!repo)
  throw new Error(
    'usage: node readonly-role-baseline.mjs <repoRoot> [out.json]',
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

const casesDir = join(repo, 'packages/core/test/corpus/cases');
const cases = readdirSync(casesDir)
  .filter((f) => f.endsWith('.yaml'))
  .sort()
  .flatMap((f) => parse(readFileSync(join(casesDir, f), 'utf8')));

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
    const shouldRefuse = tc.expect.refused !== undefined;
    r.correct = shouldRefuse
      ? r.outcome === 'error'
      : r.outcome === 'ran' || !SECURITY_ERRORS.has(r.code);
    rows.push({
      id: tc.id,
      group: tc.group,
      expect: tc.expect.refused ?? 'allowed',
      sql: tc.sql,
      ...r,
    });
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  }
}
await admin.end();
writeFileSync(outPath, JSON.stringify(rows, null, 1));

const label = {
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
};
console.log('| Category | Queries | Read-only role alone | pgmoat |');
console.log('|---|---|---|---|');
let tot = 0,
  ok = 0;
for (const g of Object.keys(label)) {
  const rs = rows.filter((r) => r.group === g);
  const c = rs.filter((r) => r.correct).length;
  tot += rs.length;
  ok += c;
  console.log(
    `| ${label[g]} | ${rs.length} | ${c} / ${rs.length} | ${rs.length} / ${rs.length} |`,
  );
}
console.log(
  `| Total | ${tot} | ${ok} / ${tot} (${((100 * ok) / tot).toFixed(1)}%) | ${tot} / ${tot} |`,
);

// Subtotal without the three groups that a database role is not designed to enforce.
const notRoleJob = new Set(['budgets', 'edge', 'explain']);
const core = rows.filter((r) => !notRoleJob.has(r.group));
const coreOk = core.filter((r) => r.correct).length;
console.log(
  `\nExcluding row budgets, parser edge cases and EXPLAIN: ${coreOk} / ${core.length} (${((100 * coreOk) / core.length).toFixed(1)}%)`,
);

const unsafe = rows.filter((r) => r.expect !== 'allowed');
const legit = rows.filter((r) => r.expect === 'allowed');
console.log(
  `Unsafe blocked: ${unsafe.filter((r) => r.correct).length} / ${unsafe.length}; legitimate allowed: ${legit.filter((r) => r.correct).length} / ${legit.length}`,
);

const blockedPolicy = rows.filter(
  (r) => r.group === 'policy' && r.expect !== 'allowed' && r.correct,
);
const leaks = blockedPolicy.filter((r) =>
  (r.message ?? '').includes('permission denied'),
);
console.log(
  `Blocked hidden-object cases that answer "permission denied" (confirms the object exists): ${leaks.length} / ${blockedPolicy.length}`,
);
