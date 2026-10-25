import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import {
  startPostgres,
  connectionUrl,
  stopPostgres,
} from './harness/postgres.js';
import { createPools, type Pools } from '../../src/postgres/pool.js';
import { executeRead } from '../../src/postgres/execute.js';
import { isPgmoatError } from '../../src/errors.js';

describe('Postgres Read Execution Path (P3.3)', () => {
  let pools: Pools;

  beforeAll(async () => {
    await startPostgres();
    pools = createPools({
      connection: {
        url: connectionUrl('pgmoat_reader'),
        schemas: ['public'],
        application_name: 'test-execute',
        pool: { min: 1, max: 5, acquire_timeout_ms: 3000 },
      },
    });
  }, 60000);

  afterAll(async () => {
    await pools?.end();
    await stopPostgres();
  });

  it('executes read statement returning rows and mapped field types', async () => {
    const res = await executeRead(
      pools,
      'SELECT id, amount, status FROM orders ORDER BY amount ASC',
      {
        entries: [['app.tenant_id', 'a0000000-0000-0000-0000-000000000001']],
        sources: { 'app.tenant_id': 'static' },
      },
      {
        max_rows: 200,
        max_query_ms: 5000,
        lock_timeout_ms: 1000,
      },
    );

    expect(res.rows.length).toBe(2);
    expect(res.truncatedByRowCap).toBe(false);
    expect(res.durationMs).toBeGreaterThanOrEqual(0);

    const amountField = res.fields.find((f) => f.name === 'amount');
    expect(amountField).toBeDefined();
    expect(amountField?.typeName).toBe('numeric');

    const statusField = res.fields.find((f) => f.name === 'status');
    expect(statusField).toBeDefined();
    expect(statusField?.typeName).toBe('text');
  });

  it('caps rows at max_rows + 1 and sets truncatedByRowCap', async () => {
    const maxRows = 200;
    const res = await executeRead(
      pools,
      'SELECT * FROM generate_series(1, 10000) AS s(n)',
      null,
      {
        max_rows: maxRows,
        max_query_ms: 5000,
        lock_timeout_ms: 1000,
      },
    );

    // Caller receives max_rows + 1 rows
    expect(res.rows.length).toBe(maxRows + 1);
    expect(res.truncatedByRowCap).toBe(true);
  });

  it('statement timeout yields PGM-303', async () => {
    let errorCaught: unknown = null;
    try {
      await executeRead(
        pools,
        'SELECT count(*) FROM generate_series(1, 100000000::bigint)',
        null,
        {
          max_rows: 200,
          max_query_ms: 200, // Very short statement timeout
          lock_timeout_ms: 1000,
        },
      );
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).toBeDefined();
    expect(isPgmoatError(errorCaught)).toBe(true);
    if (isPgmoatError(errorCaught)) {
      expect(errorCaught.code).toBe('PGM-303');
      expect(errorCaught.kind).toBe('error');
    }
  });

  it('lock timeout yields PGM-303 with lock wait message', async () => {
    // Hold an exclusive lock on orders using a separate superuser connection
    const lockClient = new pg.Client({
      connectionString: connectionUrl('postgres'),
    });
    await lockClient.connect();

    try {
      await lockClient.query('BEGIN');
      await lockClient.query('LOCK TABLE orders IN ACCESS EXCLUSIVE MODE');

      let errorCaught: unknown = null;
      try {
        await executeRead(
          pools,
          'SELECT * FROM orders',
          null,
          {
            max_rows: 200,
            max_query_ms: 5000,
            lock_timeout_ms: 200, // 200 ms lock timeout
          },
        );
      } catch (err) {
        errorCaught = err;
      }

      expect(errorCaught).toBeDefined();
      expect(isPgmoatError(errorCaught)).toBe(true);
      if (isPgmoatError(errorCaught)) {
        expect(errorCaught.code).toBe('PGM-303');
        expect(errorCaught.message).toContain('lock');
      }
    } finally {
      await lockClient.query('ROLLBACK').catch(() => {});
      await lockClient.end();
    }
  });

  it('applies transaction-local RLS variables', async () => {
    // Query tenant A
    const resA = await executeRead(
      pools,
      'SELECT count(*)::int AS count FROM orders',
      {
        entries: [['app.tenant_id', 'a0000000-0000-0000-0000-000000000001']],
        sources: { 'app.tenant_id': 'static' },
      },
      {
        max_rows: 200,
        max_query_ms: 5000,
        lock_timeout_ms: 1000,
      },
    );
    expect(Number(resA.rows[0]?.count)).toBe(2);

    // Query tenant B
    const resB = await executeRead(
      pools,
      'SELECT count(*)::int AS count FROM orders',
      {
        entries: [['app.tenant_id', 'b0000000-0000-0000-0000-000000000002']],
        sources: { 'app.tenant_id': 'static' },
      },
      {
        max_rows: 200,
        max_query_ms: 5000,
        lock_timeout_ms: 1000,
      },
    );
    expect(Number(resB.rows[0]?.count)).toBe(1);
  });

  it('abort signal yields PGM-505 and cancels backend', async () => {
    const controller = new AbortController();

    // Trigger abort shortly after query starts
    setTimeout(() => {
      controller.abort();
    }, 100);

    let errorCaught: unknown = null;
    try {
      await executeRead(
        pools,
        'SELECT pg_sleep(5)',
        null,
        {
          max_rows: 200,
          max_query_ms: 10000,
          lock_timeout_ms: 1000,
        },
        controller.signal,
      );
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).toBeDefined();
    expect(isPgmoatError(errorCaught)).toBe(true);
    if (isPgmoatError(errorCaught)) {
      expect(errorCaught.code).toBe('PGM-505');
      expect(errorCaught.kind).toBe('canceled');
    }
  });

  it('error releases destroy the connection so backend PID changes', async () => {
    const singlePool = createPools({
      connection: {
        url: connectionUrl('pgmoat_reader'),
        schemas: ['public'],
        application_name: 'test-error-destroy',
        pool: { min: 1, max: 1, acquire_timeout_ms: 3000 },
      },
    });

    try {
      // 1. Get initial backend PID
      const res1 = await executeRead(
        singlePool,
        'SELECT pg_backend_pid() AS pid',
        null,
        { max_rows: 10, max_query_ms: 3000, lock_timeout_ms: 1000 },
      );
      const pid1 = res1.rows[0]?.pid;
      expect(pid1).toBeDefined();

      // 2. Cause a SQL error (division by zero)
      let divError: unknown = null;
      try {
        await executeRead(
          singlePool,
          'SELECT 1/0',
          null,
          { max_rows: 10, max_query_ms: 3000, lock_timeout_ms: 1000 },
        );
      } catch (err) {
        divError = err;
      }
      expect(divError).toBeDefined();

      // 3. Next query must have a different backend PID because connection was destroyed
      const res2 = await executeRead(
        singlePool,
        'SELECT pg_backend_pid() AS pid',
        null,
        { max_rows: 10, max_query_ms: 3000, lock_timeout_ms: 1000 },
      );
      const pid2 = res2.rows[0]?.pid;
      expect(pid2).toBeDefined();
      expect(pid2).not.toBe(pid1);
    } finally {
      await singlePool.end();
    }
  });
});

