import pg from 'pg';
import { fail, isPgmoatError } from '../errors.js';
import type { PgmoatConfigT } from '../config/schema.js';
import { createPgTypeParserOverrides } from '../output/values.js';

export interface Logger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string | object, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
}

export type ConnectionConfig = PgmoatConfigT['connection'];

/**
 * Derives SSL configuration from connection.ssl setting.
 * Overrides URL sslmode when set.
 */
export function buildSslConfig(
  ssl?: 'disable' | 'prefer' | 'require' | 'verify-full',
): boolean | { rejectUnauthorized: boolean } | undefined {
  if (ssl === 'disable') return false;
  if (ssl === 'verify-full') return { rejectUnauthorized: true };
  if (ssl === 'require') return { rejectUnauthorized: false };
  if (ssl === 'prefer') return { rejectUnauthorized: false };
  return undefined;
}

/**
 * Creates the primary query pool with bounded size and timeouts.
 */
export function createQueryPool(
  cfg: ConnectionConfig,
  logger?: Logger,
): pg.Pool {
  const ssl = buildSslConfig(cfg.ssl);

  const pool = new pg.Pool({
    connectionString: cfg.url,
    min: cfg.pool.min,
    max: cfg.pool.max,
    connectionTimeoutMillis: cfg.pool.acquire_timeout_ms,
    idleTimeoutMillis: 30_000,
    application_name: cfg.application_name,
    statement_timeout: undefined, // set per transaction instead
    types: createPgTypeParserOverrides(),
    ...(ssl !== undefined ? { ssl } : {}),
  });

  // pool.on('error') logs to stderr via the logger and does not crash the process
  pool.on('error', (err) => {
    logger?.error(
      `Unexpected error on idle query pool client: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  return pool;
}

/**
 * Acquires a client from the pool with an explicit timeout, mapping timeouts to PGM-503.
 */
export async function acquire(
  pool: pg.Pool,
  timeoutMs?: number,
): Promise<pg.PoolClient> {
  const timeout =
    timeoutMs ?? pool.options.connectionTimeoutMillis ?? 3000;

  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(fail('PGM-503', 'Timed out waiting for a database connection'));
    }, timeout);
  });

  try {
    const client = await Promise.race([
      pool.connect().then((c) => {
        if (timedOut) {
          c.release(true);
        }
        return c;
      }),
      timeoutPromise,
    ]);
    return client;
  } catch (err: unknown) {
    if (isPgmoatError(err)) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('timeout')) {
      throw fail('PGM-503', 'Timed out waiting for a database connection');
    }
    throw err;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Single-connection control client for executing administrative commands like pg_cancel_backend.
 * Lazily connected with exponential backoff on connection failure.
 */
export class ControlClient {
  private client: pg.Client | null = null;
  private connectingPromise: Promise<pg.Client> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoffMs = 100;
  private closed = false;

  constructor(
    private readonly config: ConnectionConfig,
    private readonly logger?: Logger,
  ) {}

  private createClient(): pg.Client {
    const ssl = buildSslConfig(this.config.ssl);
    const client = new pg.Client({
      connectionString: this.config.url,
      application_name: `${this.config.application_name}-control`,
      statement_timeout: 5000,
      ...(ssl !== undefined ? { ssl } : {}),
    });

    client.on('error', (err) => {
      this.logger?.warn?.(
        `Control client error: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.handleDisconnect();
    });

    client.on('end', () => {
      this.handleDisconnect();
    });

    return client;
  }

  private handleDisconnect(): void {
    if (this.closed) return;
    this.client = null;
    this.connectingPromise = null;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed) {
        this.ensureConnected().catch((err) => {
          this.logger?.warn?.(
            `Control client reconnect attempt failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }
    }, delay);
  }

  async ensureConnected(): Promise<pg.Client> {
    if (this.closed) {
      throw new Error('Control client is closed');
    }
    if (this.client) {
      return this.client;
    }
    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    this.connectingPromise = (async () => {
      const client = this.createClient();
      try {
        await client.connect();
        this.client = client;
        this.backoffMs = 100; // Reset backoff on success
        return client;
      } catch (err) {
        this.client = null;
        this.scheduleReconnect();
        throw err;
      } finally {
        this.connectingPromise = null;
      }
    })();

    return this.connectingPromise;
  }

  /**
   * Cancels a running backend process in PostgreSQL using parameterized query.
   */
  async cancelBackend(pid: number): Promise<boolean> {
    try {
      const client = await this.ensureConnected();
      const res = await client.query<{ canceled: boolean }>(
        'SELECT pg_cancel_backend($1) AS canceled',
        [pid],
      );
      return res.rows[0]?.canceled === true;
    } catch (err) {
      this.logger?.error(
        `Failed to cancel backend ${pid}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * Closes the control client and clears any reconnection timers.
   */
  async end(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      const c = this.client;
      this.client = null;
      await c.end().catch(() => {});
    }
  }
}

export interface Pools {
  query: pg.Pool;
  control: ControlClient;
  end(): Promise<void>;
}

/**
 * Creates query pool and control client from configuration.
 */
export function createPools(
  config: PgmoatConfigT | { connection: ConnectionConfig },
  logger?: Logger,
): Pools {
  const query = createQueryPool(config.connection, logger);
  const control = new ControlClient(config.connection, logger);

  return {
    query,
    control,
    async end(): Promise<void> {
      await Promise.allSettled([query.end(), control.end()]);
    },
  };
}

