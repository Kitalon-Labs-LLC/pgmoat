import {
  pg,
  runSafety,
  type PolicyIndex,
  type PipelineSafetyResult,
} from '@pgmoat/core';
import { BUNDLED_CASES } from '../corpus/cases.js';
import { CORPUS_FIXTURE_SQL } from '../corpus/fixture-sql.js';
import { exitWithError } from '../exit.js';

export interface TestCorpusOptions {
  url?: string | undefined;
  group?: string | undefined;
  force?: boolean | undefined;
  json?: boolean | undefined;
}

export function buildCorpusPolicyIndex(schemaName: string): PolicyIndex & {
  visibleColumns: Record<string, readonly string[]>;
} {
  const visibleCols: Record<string, readonly string[]> = {
    [`${schemaName}.users`]: [
      'id',
      'tenant_id',
      'name',
      'email',
      'role',
      'created_at',
      'updated_at',
    ],
    'public.users': [
      'id',
      'tenant_id',
      'name',
      'email',
      'role',
      'created_at',
      'updated_at',
    ],
    [`${schemaName}.orders`]: ['id', 'tenant_id', 'user_id', 'amount', 'status', 'created_at'],
    'public.orders': ['id', 'tenant_id', 'user_id', 'amount', 'status', 'created_at'],
    [`${schemaName}.tickets`]: ['id', 'tenant_id', 'user_id', 'title', 'body', 'status', 'created_at'],
    'public.tickets': ['id', 'tenant_id', 'user_id', 'title', 'body', 'status', 'created_at'],
    [`${schemaName}.customers`]: ['id', 'tenant_id', 'name', 'email', 'stripe_customer_id', 'tier', 'created_at'],
    'public.customers': ['id', 'tenant_id', 'name', 'email', 'stripe_customer_id', 'tier', 'created_at'],
    [`${schemaName}.events`]: ['id', 'tenant_id', 'event_type', 'payload', 'created_at'],
    'public.events': ['id', 'tenant_id', 'event_type', 'payload', 'created_at'],
  };

  const hiddenCols = new Map<string, ReadonlySet<string>>([
    [`${schemaName}.users`, new Set(['password_hash', 'mfa_secret'])],
    ['public.users', new Set(['password_hash', 'mfa_secret'])],
  ]);

  return {
    exposedSchemas: [schemaName, 'public'],
    knownRelations: new Set([
      `${schemaName}.users`,
      'public.users',
      `${schemaName}.orders`,
      'public.orders',
      `${schemaName}.tickets`,
      'public.tickets',
      `${schemaName}.customers`,
      'public.customers',
      `${schemaName}.events`,
      'public.events',
      `${schemaName}.internal_audit`,
      'public.internal_audit',
      `${schemaName}.api_keys`,
      'public.api_keys',
    ]),
    hiddenRelations: new Set([
      `${schemaName}.internal_audit`,
      'public.internal_audit',
      `${schemaName}.api_keys`,
      'public.api_keys',
    ]),
    hiddenColumns: hiddenCols,
    visibleColumns: visibleCols,
  };
}

export async function testCorpusCommand(options: TestCorpusOptions = {}): Promise<void> {
  const url = options.url ?? process.env.PGMOAT_DATABASE_URL;
  if (!url) {
    exitWithError(new Error('Connection URL required. Pass --url <url> or set PGMOAT_DATABASE_URL.'));
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  let schemaName = '';
  let cleanedUp = false;

  const cleanup = async () => {
    if (cleanedUp || !schemaName) return;
    cleanedUp = true;
    try {
      const dropSql = ['DROP SCHEMA IF EXISTS ', schemaName, ' CASCADE'].join('');
      await client.query(dropSql);
    } catch {
      // ignore drop errors on exit
    }
  };

  const sigintHandler = async () => {
    await cleanup();
    await client.end().catch(() => {});
    process.exit(130);
  };

  process.on('SIGINT', sigintHandler);

  try {
    // 1. Safety check: refuse if target database has more than 10 non-system tables unless --force
    const countRes = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')",
    );
    const tableCount = countRes.rows[0]?.count ?? 0;
    if (tableCount > 10 && !options.force) {
      process.stdout.write(
        `x test-corpus refuses to run: the database has ${tableCount} non-system tables and does not look disposable.\n` +
          `  Use a scratch database, or pass --force if you are sure.\n`,
      );
      process.exit(1);
    }

    // 2. Create random schema and seed DDL
    const rand = Math.random().toString(36).slice(2, 6);
    schemaName = ['pgmoat_corpus_', rand].join('');

    process.stdout.write(['Seeding schema ', schemaName, ' ... '].join(''));
    const createSchemaSql = ['CREATE SCHEMA ', schemaName].join('');
    await client.query(createSchemaSql);

    const setSearchPathSql = ['SET search_path TO ', schemaName, ', public'].join('');
    await client.query(setSearchPathSql);
    await client.query(CORPUS_FIXTURE_SQL);
    process.stdout.write('ok\n');

    // 3. Get Postgres version
    const versionRes = await client.query<{ server_version: string }>('SHOW server_version');
    const pgVersion = versionRes.rows[0]?.server_version ?? '17';

    // 4. Select cases
    let cases = BUNDLED_CASES;
    if (options.group) {
      cases = cases.filter((c) => c.group === options.group);
      if (cases.length === 0) {
        throw new Error(`No cases found for group "${options.group}"`);
      }
    }

    process.stdout.write(
      ['Running ', cases.length, ' cases against Postgres ', pgVersion, '\n\n'].join(''),
    );

    const policyIndex = buildCorpusPolicyIndex(schemaName);

    // Group order per spec/06 section 2.11
    const groupOrder = [
      'allowed',
      'statements',
      'stacking',
      'cte',
      'functions',
      'sql-exec',
      'locking',
      'explain',
      'policy',
      'budgets',
      'edge',
    ];

    const groupStats = new Map<string, { total: number; passed: number; failed: number }>();
    for (const g of groupOrder) {
      groupStats.set(g, { total: 0, passed: 0, failed: 0 });
    }

    for (const testCase of cases) {
      let stats = groupStats.get(testCase.group);
      if (!stats) {
        stats = { total: 0, passed: 0, failed: 0 };
        groupStats.set(testCase.group, stats);
      }
      stats.total++;

      let casePassed = true;

      // Pipeline safety check
      const mode = testCase.group === 'explain' ? 'explain' : 'query';
      let safetyRes: PipelineSafetyResult;
      try {
        safetyRes = await runSafety(testCase.sql, {
          policyIndex,
          mode,
          budgets: {
            max_rows: 200,
            max_sql_chars: 65_536,
          },
          checkColumnsOptions: {
            visibleColumns: policyIndex.visibleColumns,
          },
        });
      } catch {
        safetyRes = {
          allowed: false,
          code: 'PGM-203',
          message: 'Safety evaluation error',
          timings: { parseMs: 0, classifyMs: 0, policyMs: 0, rewriteMs: 0, fingerprintMs: 0, totalMs: 0 },
        };
      }

      if (testCase.expect.allowed) {
        if (!safetyRes.allowed) {
          casePassed = false;
        } else if (testCase.executes) {
          // Verify execution succeeds in database
          try {
            await client.query(safetyRes.sql);
          } catch {
            casePassed = false;
          }
        }
      } else {
        // Expected refusal
        if (safetyRes.allowed) {
          casePassed = false;
        } else if (testCase.expect.refused && safetyRes.code !== testCase.expect.refused) {
          casePassed = false;
        }
      }

      if (casePassed) {
        stats.passed++;
      } else {
        stats.failed++;
      }
    }

    // 5. Report results
    let totalPassed = 0;
    let totalFailed = 0;

    for (const [groupName, stats] of groupStats.entries()) {
      if (stats.total === 0) continue;
      totalPassed += stats.passed;
      totalFailed += stats.failed;

      const groupCol = groupName.padEnd(13, ' ');
      const rawCount = `${stats.passed}/${stats.total}`;
      const countCol = rawCount.length <= 3 ? ` ${rawCount}`.padEnd(8, ' ') : rawCount.padEnd(8, ' ');
      const statusMarker = stats.failed === 0 ? 'ok' : 'FAIL';
      process.stdout.write(`${groupCol}${countCol}${statusMarker}\n`);
    }

    process.stdout.write('\n');
    process.stdout.write(
      `${totalPassed} passed, ${totalFailed} failed.  Dropped schema ${schemaName}.\n`,
    );

    if (totalFailed > 0) {
      process.exit(1);
    }
  } finally {
    process.removeListener('SIGINT', sigintHandler);
    await cleanup();
    await client.end().catch(() => {});
  }
}
