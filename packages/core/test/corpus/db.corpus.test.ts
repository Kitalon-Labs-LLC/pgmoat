import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import {
  startPostgres,
  connectionUrl,
  stopPostgres,
} from '../integration/harness/postgres.js';
import { createPools, type Pools } from '../../src/postgres/pool.js';
import { executeRead } from '../../src/postgres/execute.js';
import { loadAllCases, runCase } from './runner.js';

describe('Corpus Database Mode - Layer 4 Proof (P3.7)', () => {
  let writerPools: Pools;
  let readerPools: Pools;
  let adminClient: pg.Client;
  let initialCounts: Record<string, number>;
  let initialSchemaChecksum: string;

  const allCases = loadAllCases();
  const dbBlocksCases = allCases.filter((c) => c.db_blocks === true);
  const executesCases = allCases.filter((c) => c.executes === true);

  async function getTableCounts(client: pg.Client): Promise<Record<string, number>> {
    const tables = ['tenants', 'users', 'orders', 'tickets', 'customers', 'api_keys', 'internal_audit'];
    const counts: Record<string, number> = {};
    for (const t of tables) {
      const res = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${t}`);
      counts[t] = res.rows[0]?.count ?? 0;
    }
    return counts;
  }

  async function getSchemaChecksum(client: pg.Client): Promise<string> {
    const res = await client.query<{ checksum: string }>(`
      SELECT md5(string_agg(c.relname || ':' || c.relkind::text, ',' ORDER BY c.relname)) AS checksum
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
    `);
    return res.rows[0]?.checksum ?? '';
  }

  beforeAll(async () => {
    await startPostgres();

    adminClient = new pg.Client({ connectionString: connectionUrl('postgres') });
    await adminClient.connect();

    writerPools = createPools({
      connection: {
        url: connectionUrl('pgmoat_writer'),
        schemas: ['public'],
        application_name: 'corpus-db-writer',
        pool: { min: 1, max: 5, acquire_timeout_ms: 3000 },
      },
    });

    readerPools = createPools({
      connection: {
        url: connectionUrl('pgmoat_reader'),
        schemas: ['public'],
        application_name: 'corpus-db-reader',
        pool: { min: 1, max: 5, acquire_timeout_ms: 3000 },
      },
    });

    initialCounts = await getTableCounts(adminClient);
    initialSchemaChecksum = await getSchemaChecksum(adminClient);

    console.log(`\n--- Corpus DB Mode Summary ---`);
    console.log(`  db_blocks cases: ${dbBlocksCases.length}`);
    console.log(`  executes cases:  ${executesCases.length}`);
    console.log(`-------------------------------\n`);
  }, 60000);

  afterAll(async () => {
    await writerPools?.end();
    await readerPools?.end();
    await adminClient?.end();
    await stopPostgres();
  });

  describe('db_blocks: Postgres layer-4 blocks refused write/DDL/stacking', () => {
    it.each(dbBlocksCases)('$id ($group): $sql', async (testCase) => {
      let blocked = false;
      let errorThrown: unknown = null;

      try {
        await executeRead(
          writerPools,
          testCase.sql,
          { entries: [], sources: {} },
          { max_rows: 200, max_query_ms: 5000, lock_timeout_ms: 1000 },
          new AbortController().signal,
        );
      } catch (err) {
        blocked = true;
        errorThrown = err;
      }

      expect(blocked, `Postgres should block execution of: ${testCase.sql}`).toBe(true);
      expect(errorThrown).toBeDefined();

      // Verify no data changed
      const currentCounts = await getTableCounts(adminClient);
      expect(currentCounts).toEqual(initialCounts);

      // Verify no schema changes
      const currentChecksum = await getSchemaChecksum(adminClient);
      expect(currentChecksum).toBe(initialSchemaChecksum);
    });
  });

  describe('executes: Allowed queries execute successfully with reader role', () => {
    it.each(executesCases)('$id ($group): $sql', async (testCase) => {
      // 1. Run through safety pipeline to get rewritten SQL with injected limits
      const safetyRes = await runCase(testCase);
      expect(safetyRes.allowed).toBe(true);
      if (!safetyRes.allowed) return;

      // 2. Execute as pgmoat_reader with tenant A
      const execRes = await executeRead(
        readerPools,
        safetyRes.sql,
        {
          entries: [['app.tenant_id', 'a0000000-0000-0000-0000-000000000001']],
          sources: { 'app.tenant_id': 'static' },
        },
        { max_rows: 200, max_query_ms: 5000, lock_timeout_ms: 1000 },
        new AbortController().signal,
      );

      expect(execRes.rows).toBeDefined();
    });
  });
});
