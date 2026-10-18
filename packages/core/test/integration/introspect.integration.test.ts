import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import {
  startPostgres,
  connectionUrl,
  stopPostgres,
} from './harness/postgres.js';
import { createPools, type Pools } from '../../src/postgres/pool.js';
import { introspect } from '../../src/postgres/introspect.js';

describe('Postgres Catalog Introspection (P3.4)', () => {
  let pools: Pools;

  beforeAll(async () => {
    await startPostgres();
    pools = createPools({
      connection: {
        url: connectionUrl('postgres'),
        schemas: ['public'],
        application_name: 'test-introspect',
        pool: { min: 1, max: 5, acquire_timeout_ms: 5000 },
      },
    });
  }, 60000);

  afterAll(async () => {
    await pools?.end();
    await stopPostgres();
  });

  it('introspects seed schema: relations, foreign keys, indexes, RLS flags, views, comments', async () => {
    const result = await introspect(pools, ['public']);

    expect(result.serverVersionNum).toBeGreaterThanOrEqual(150000);
    expect(result.currentUser).toBe('postgres');

    const names = result.relations.map((r) => r.name);
    expect(names).toContain('users');
    expect(names).toContain('orders');
    expect(names).toContain('tickets');
    expect(names).toContain('customers');
    expect(names).toContain('order_totals');

    // 1. View kind check
    const viewRel = result.relations.find((r) => r.name === 'order_totals');
    expect(viewRel).toBeDefined();
    expect(viewRel?.kind).toBe('v');
    expect(viewRel?.kindName).toBe('view');

    // 2. RLS flags check on orders
    const ordersRel = result.relations.find((r) => r.name === 'orders');
    expect(ordersRel).toBeDefined();
    expect(ordersRel?.kind).toBe('r');
    expect(ordersRel?.kindName).toBe('table');
    expect(ordersRel?.relrowsecurity).toBe(true);
    expect(ordersRel?.relforcerowsecurity).toBe(true);

    // 3. Primary key check
    expect(ordersRel?.primaryKey).toEqual(['id']);

    // 4. Foreign key check
    const tenantFk = ordersRel?.foreignKeys.find(
      (fk) => fk.references.relation === 'tenants',
    );
    expect(tenantFk).toBeDefined();
    expect(tenantFk?.columns).toEqual(['tenant_id']);
    expect(tenantFk?.references.columns).toEqual(['id']);
    expect(tenantFk?.onDelete).toBe('CASCADE');

    // 5. Index check on users
    const usersRel = result.relations.find((r) => r.name === 'users');
    expect(usersRel).toBeDefined();
    expect(usersRel?.indexes.length).toBeGreaterThan(0);
    const pkIndex = usersRel?.indexes.find((i) => i.primary);
    expect(pkIndex).toBeDefined();
    expect(pkIndex?.columns).toEqual(['id']);

    // 6. Comments check
    expect(usersRel?.description).toBe('User accounts table');
    const emailCol = usersRel?.columns.find((c) => c.name === 'email');
    expect(emailCol).toBeDefined();
    expect(emailCol?.description).toBe('User primary email address');
  });

  it('introspects a generated 100-table schema in under 1 second', async () => {
    const client = new pg.Client({
      connectionString: connectionUrl('postgres'),
    });
    await client.connect();

    const tempSchema = 'temp_perf_test';
    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${tempSchema}`);

      // Generate 100 tables
      const tableQueries: string[] = [];
      for (let i = 1; i <= 100; i++) {
        tableQueries.push(
          `CREATE TABLE ${tempSchema}.tbl_${i} (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            val INT DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT now()
          );`,
        );
      }
      await client.query(tableQueries.join('\n'));

      // Run introspection and measure execution time
      const start = performance.now();
      const res = await introspect(pools, [tempSchema]);
      const durationMs = performance.now() - start;

      // Timing assertion: must complete under 1 s (1000 ms)
      expect(durationMs).toBeLessThan(1000);
      expect(res.relations.length).toBe(100);
      expect(res.relations[0]?.columns.length).toBe(4);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${tempSchema} CASCADE`);
      await client.end();
    }
  });
});
