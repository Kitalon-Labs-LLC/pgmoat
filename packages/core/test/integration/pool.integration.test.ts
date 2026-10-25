import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import {
  startPostgres,
  connectionUrl,
  stopPostgres,
} from './harness/postgres.js';
import {
  createQueryPool,
  acquire,
  ControlClient,
  createPools,
  buildSslConfig,
} from '../../src/postgres/pool.js';
import { isPgmoatError } from '../../src/errors.js';

describe('Postgres Pools and Control Client Integration (P3.2)', () => {
  beforeAll(async () => {
    await startPostgres();
  }, 60000);

  afterAll(async () => {
    await stopPostgres();
  });

  it('buildSslConfig handles ssl modes correctly', () => {
    expect(buildSslConfig('disable')).toBe(false);
    expect(buildSslConfig('verify-full')).toEqual({ rejectUnauthorized: true });
    expect(buildSslConfig('require')).toEqual({ rejectUnauthorized: false });
    expect(buildSslConfig('prefer')).toEqual({ rejectUnauthorized: false });
    expect(buildSslConfig(undefined)).toBeUndefined();
  });

  it('acquire timeout with max: 1 and a held client yields PGM-503 within acquire_timeout_ms + 200', async () => {
    const acquireTimeoutMs = 300;
    const pool = createQueryPool({
      url: connectionUrl('pgmoat_reader'),
      schemas: ['public'],
      application_name: 'test-pool-timeout',
      pool: {
        min: 0,
        max: 1,
        acquire_timeout_ms: acquireTimeoutMs,
      },
    });

    try {
      // 1. Acquire the single allowed connection and hold it
      const client1 = await acquire(pool, 5000);
      expect(client1).toBeDefined();

      // 2. Attempt to acquire another connection
      const start = performance.now();
      let errorCaught: unknown = null;

      try {
        await acquire(pool, acquireTimeoutMs);
      } catch (err) {
        errorCaught = err;
      }

      const elapsed = performance.now() - start;

      // Expect PGM-503
      expect(errorCaught).toBeDefined();
      expect(isPgmoatError(errorCaught)).toBe(true);
      if (isPgmoatError(errorCaught)) {
        expect(errorCaught.code).toBe('PGM-503');
      }

      // Timing check: within acquire_timeout_ms + 200ms
      expect(elapsed).toBeGreaterThanOrEqual(acquireTimeoutMs - 50);
      expect(elapsed).toBeLessThanOrEqual(acquireTimeoutMs + 200);

      // Release client1
      client1.release();
    } finally {
      await pool.end();
    }
  });

  it('release(true) destroys the connection so backend PID changes on next acquire', async () => {
    const pool = createQueryPool({
      url: connectionUrl('pgmoat_reader'),
      schemas: ['public'],
      application_name: 'test-destroy-conn',
      pool: {
        min: 1,
        max: 1,
        acquire_timeout_ms: 3000,
      },
    });

    try {
      // 1. Acquire first client and get PID
      const client1 = await acquire(pool);
      const res1 = await client1.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );
      const pid1 = res1.rows[0]?.pid;
      expect(pid1).toBeDefined();

      // 2. Release with true (destroys connection)
      client1.release(true);

      // 3. Acquire next client and get PID
      const client2 = await acquire(pool);
      const res2 = await client2.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );
      const pid2 = res2.rows[0]?.pid;
      expect(pid2).toBeDefined();

      // Backend PID must be different because previous connection was destroyed
      expect(pid2).not.toBe(pid1);

      // 4. Normal release without true should reuse the same connection
      client2.release();
      const client3 = await acquire(pool);
      const res3 = await client3.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );
      const pid3 = res3.rows[0]?.pid;
      expect(pid3).toBe(pid2);

      client3.release();
    } finally {
      await pool.end();
    }
  });

  it('cancelBackend cancels a running pg_sleep started on another connection', async () => {
    const control = new ControlClient({
      url: connectionUrl('postgres'), // superuser or role that can cancel
      schemas: ['public'],
      application_name: 'test-control',
      pool: { min: 1, max: 1, acquire_timeout_ms: 3000 },
    });

    // Create a client directly to run pg_sleep
    const workerClient = new pg.Client({
      connectionString: connectionUrl('postgres'),
    });
    await workerClient.connect();

    try {
      // Get the backend PID of the worker connection
      const pidRes = await workerClient.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );
      const workerPid = pidRes.rows[0]?.pid;
      expect(workerPid).toBeDefined();

      // Start a long-running query
      let queryError: unknown = null;
      const queryPromise = workerClient
        .query('SELECT pg_sleep(10)')
        .catch((err) => {
          queryError = err;
        });

      // Wait a moment for query to begin executing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Cancel the backend using control client
      const cancelSuccess = await control.cancelBackend(workerPid!);
      expect(cancelSuccess).toBe(true);

      // Wait for query to complete / be aborted
      await queryPromise;

      // The query must have been canceled with SQLSTATE 57014 (query_canceled)
      expect(queryError).toBeDefined();
      expect((queryError as { code?: string }).code).toBe('57014');
    } finally {
      await workerClient.end().catch(() => {});
      await control.end();
    }
  });

  it('createPools factory creates working query pool and control client', async () => {
    const pools = createPools({
      connection: {
        url: connectionUrl('pgmoat_reader'),
        schemas: ['public'],
        application_name: 'test-pools-factory',
        pool: { min: 1, max: 5, acquire_timeout_ms: 3000 },
      },
    });

    try {
      const client = await acquire(pools.query);
      const res = await client.query('SELECT 1 AS num');
      expect(res.rows[0]?.num).toBe(1);
      client.release();
    } finally {
      await pools.end();
    }
  });
});
