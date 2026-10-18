import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import {
  startPostgres,
  connectionUrl,
  resetData,
  stopPostgres,
} from './postgres.js';

describe('Postgres Integration Harness Smoke Test (P3.1)', () => {
  beforeAll(async () => {
    await startPostgres();
  }, 60000);

  afterAll(async () => {
    await stopPostgres();
  });

  it('connects as pgmoat_reader and respects RLS tenant isolation', async () => {
    const client = new pg.Client({
      connectionString: connectionUrl('pgmoat_reader'),
    });
    await client.connect();

    try {
      // 1. In a transaction, set tenant A and query orders
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('app.tenant_id', 'a0000000-0000-0000-0000-000000000001', true)",
      );

      const resA = await client.query<{ count: string }>(
        'SELECT count(*) FROM orders',
      );
      expect(Number(resA.rows[0]?.count)).toBe(2);

      const rowsA = await client.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM orders',
      );
      for (const row of rowsA.rows) {
        expect(row.tenant_id).toBe('a0000000-0000-0000-0000-000000000001');
      }
      await client.query('COMMIT');

      // 2. In a second transaction, set tenant B and query orders
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('app.tenant_id', 'b0000000-0000-0000-0000-000000000002', true)",
      );

      const resB = await client.query<{ count: string }>(
        'SELECT count(*) FROM orders',
      );
      expect(Number(resB.rows[0]?.count)).toBe(1);

      const rowsB = await client.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM orders',
      );
      expect(rowsB.rows[0]?.tenant_id).toBe(
        'b0000000-0000-0000-0000-000000000002',
      );
      await client.query('COMMIT');

      // 3. Without setting tenant_id, RLS filters out all rows
      await client.query('BEGIN');
      const resNone = await client.query<{ count: string }>(
        'SELECT count(*) FROM orders',
      );
      expect(Number(resNone.rows[0]?.count)).toBe(0);
      await client.query('COMMIT');
    } finally {
      await client.end();
    }
  });

  it('enforces column-level permissions on pgmoat_reader', async () => {
    const client = new pg.Client({
      connectionString: connectionUrl('pgmoat_reader'),
    });
    await client.connect();

    try {
      // Allowed columns succeed
      const allowedRes = await client.query(
        'SELECT id, name, email FROM users LIMIT 1',
      );
      expect(allowedRes.rows.length).toBe(1);

      // Hidden column (password_hash) fails with permission denied (42501)
      let deniedError: unknown = null;
      try {
        await client.query('SELECT password_hash FROM users LIMIT 1');
      } catch (err) {
        deniedError = err;
      }
      expect(deniedError).toBeDefined();
      expect((deniedError as { code?: string }).code).toBe('42501');

      // Hidden table (internal_audit) fails with permission denied (42501)
      let tableDeniedError: unknown = null;
      try {
        await client.query('SELECT * FROM internal_audit');
      } catch (err) {
        tableDeniedError = err;
      }
      expect(tableDeniedError).toBeDefined();
      expect((tableDeniedError as { code?: string }).code).toBe('42501');
    } finally {
      await client.end();
    }
  });

  it('resets data cleanly using resetData()', async () => {
    // Modify data as superuser
    const superClient = new pg.Client({
      connectionString: connectionUrl('postgres'),
    });
    await superClient.connect();
    try {
      await superClient.query(
        "DELETE FROM orders WHERE tenant_id = 'a0000000-0000-0000-0000-000000000001'",
      );
      const countRes = await superClient.query<{ count: string }>(
        'SELECT count(*) FROM orders',
      );
      expect(Number(countRes.rows[0]?.count)).toBe(1);
    } finally {
      await superClient.end();
    }

    // Call resetData()
    await resetData();

    // Verify all 3 orders are back
    const readerClient = new pg.Client({
      connectionString: connectionUrl('postgres'),
    });
    await readerClient.connect();
    try {
      const restoredRes = await readerClient.query<{ count: string }>(
        'SELECT count(*) FROM orders',
      );
      expect(Number(restoredRes.rows[0]?.count)).toBe(3);
    } finally {
      await readerClient.end();
    }
  });
});

