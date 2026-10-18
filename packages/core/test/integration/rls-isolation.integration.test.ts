import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import {
  startPostgres,
  connectionUrl,
  stopPostgres,
} from './harness/postgres.js';
import { createPools, acquire, type Pools } from '../../src/postgres/pool.js';
import { executeRead } from '../../src/postgres/execute.js';
import type { ResolvedRls } from '../../src/types.js';

const TENANT_A = 'a0000000-0000-0000-0000-000000000001';
const TENANT_B = 'b0000000-0000-0000-0000-000000000002';

describe('RLS Isolation, Session Leak, and Injection Suite (P3.8)', () => {
  let pools: Pools;
  let adminClient: pg.Client;

  beforeAll(async () => {
    await startPostgres();

    adminClient = new pg.Client({ connectionString: connectionUrl('postgres') });
    await adminClient.connect();

    // Pool size 4 for concurrency test
    pools = createPools({
      connection: {
        url: connectionUrl('pgmoat_reader'),
        schemas: ['public'],
        application_name: 'test-rls-isolation',
        pool: { min: 4, max: 4, acquire_timeout_ms: 10000 },
      },
    });
  }, 60000);

  afterAll(async () => {
    await pools?.end();
    await adminClient?.end();
    await stopPostgres();
  });

  it('FR-RLS-06: 1,000 alternating-tenant queries with concurrency 16 show zero cross-tenant rows', async () => {
    const TOTAL_QUERIES = 1000;
    const CONCURRENCY = 16;
    const budgets = {
      max_rows: 200,
      max_query_ms: 10000,
      lock_timeout_ms: 2000,
    };

    let tenantAQueryCount = 0;
    let tenantBQueryCount = 0;
    let tenantARowsTotal = 0;
    let tenantBRowsTotal = 0;
    let crossTenantViolations = 0;

    const started = performance.now();

    // Generate 1,000 query tasks with random interleaving of tenant A and B
    const tasks = Array.from({ length: TOTAL_QUERIES }, () => {
      const isTenantA = Math.random() < 0.5;
      const expectedTenant = isTenantA ? TENANT_A : TENANT_B;
      const rls: ResolvedRls = {
        entries: [['app.tenant_id', expectedTenant]],
        sources: { 'app.tenant_id': 'static' },
      };

      return async () => {
        const res = await executeRead(
          pools,
          'SELECT id, tenant_id, amount FROM orders ORDER BY id',
          rls,
          budgets,
          new AbortController().signal,
        );

        if (isTenantA) {
          tenantAQueryCount++;
          tenantARowsTotal += res.rows.length;
          // Tenant A has 2 orders in seed
          if (res.rows.length !== 2) {
            crossTenantViolations++;
          }
          for (const row of res.rows) {
            if (row.tenant_id !== TENANT_A) {
              crossTenantViolations++;
            }
          }
        } else {
          tenantBQueryCount++;
          tenantBRowsTotal += res.rows.length;
          // Tenant B has 1 order in seed
          if (res.rows.length !== 1) {
            crossTenantViolations++;
          }
          for (const row of res.rows) {
            if (row.tenant_id !== TENANT_B) {
              crossTenantViolations++;
            }
          }
        }
      };
    });

    // Worker pool to execute with concurrency 16
    let currentIndex = 0;
    async function worker() {
      while (currentIndex < tasks.length) {
        const index = currentIndex++;
        const task = tasks[index];
        if (task) {
          await task();
        }
      }
    }

    const workers = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(workers);

    const durationMs = performance.now() - started;

    console.log(`\n--- FR-RLS-06 Isolation Test Report ---`);
    console.log(`  Total queries executed: ${TOTAL_QUERIES}`);
    console.log(`  Tenant A queries:       ${tenantAQueryCount} (rows returned: ${tenantARowsTotal})`);
    console.log(`  Tenant B queries:       ${tenantBQueryCount} (rows returned: ${tenantBRowsTotal})`);
    console.log(`  Cross-tenant rows:      ${crossTenantViolations}`);
    console.log(`  Total duration:         ${durationMs.toFixed(1)} ms (${(durationMs / TOTAL_QUERIES).toFixed(2)} ms/query)`);
    console.log(`----------------------------------------\n`);

    expect(crossTenantViolations).toBe(0);
    expect(tenantAQueryCount + tenantBQueryCount).toBe(TOTAL_QUERIES);
  }, 120000);

  it('FR-RLS-07: session variables are not visible on the pooled connection after transaction ends', async () => {
    // Single-connection pool to guarantee reusing the identical backend connection
    const singleConnPools = createPools({
      connection: {
        url: connectionUrl('pgmoat_reader'),
        schemas: ['public'],
        application_name: 'test-rls-leak',
        pool: { min: 1, max: 1, acquire_timeout_ms: 3000 },
      },
    });

    try {
      // 1. Run transaction for Tenant A
      const rls: ResolvedRls = {
        entries: [['app.tenant_id', TENANT_A]],
        sources: { 'app.tenant_id': 'static' },
      };

      const res = await executeRead(
        singleConnPools,
        'SELECT id, tenant_id FROM orders',
        rls,
        { max_rows: 200, max_query_ms: 5000, lock_timeout_ms: 1000 },
        new AbortController().signal,
      );

      expect(res.rows.length).toBe(2);
      expect(res.rows[0]?.tenant_id).toBe(TENANT_A);

      // 2. Immediately acquire the exact same pooled connection
      const client = await acquire(singleConnPools.query, 3000);
      try {
        const checkRes = await client.query<{ tenant_id: string | null }>(
          "SELECT current_setting('app.tenant_id', true) AS tenant_id",
        );
        const tenantSetting = checkRes.rows[0]?.tenant_id;

        // In Postgres, set_config(..., true) is transaction-local; once COMMIT/ROLLBACK occurs,
        // current_setting('app.tenant_id', true) returns null or empty string
        expect(tenantSetting === null || tenantSetting === '').toBe(true);
      } finally {
        client.release();
      }
    } finally {
      await singleConnPools.end();
    }
  });

  it('SEC-INJECT-02: SQL injection in tenant session variable is safely parameterized without executing payload', async () => {
    const maliciousPayload = "'; DROP TABLE orders; --";

    const rls: ResolvedRls = {
      entries: [['app.tenant_id', maliciousPayload]],
      sources: { 'app.tenant_id': 'static' },
    };

    // Because the payload is passed as a bound parameter to set_config($1, $2, true),
    // it never executes as SQL text.
    // When RLS evaluates `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`,
    // casting malicious string to UUID will fail with 42883 / 22P02, OR if safe, return zero rows.
    try {
      const res = await executeRead(
        pools,
        'SELECT count(*) FROM orders',
        rls,
        { max_rows: 200, max_query_ms: 5000, lock_timeout_ms: 1000 },
        new AbortController().signal,
      );
      // If it doesn't error on cast, it must return 0 rows for that tenant
      expect(Number(res.rows[0]?.count ?? 0)).toBe(0);
    } catch (err: unknown) {
      // Postgres invalid input syntax for type uuid (22P02) is expected and completely safe
      expect(err).toBeDefined();
    }

    // Verify orders table still exists and data remains intact!
    const verifyRes = await adminClient.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM orders',
    );
    expect(verifyRes.rows[0]?.count).toBe(3); // 2 orders for A + 1 for B
  });
});
