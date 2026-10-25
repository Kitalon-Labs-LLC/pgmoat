import { PgmoatError, refuse, fail, isPgmoatError } from '../errors.js';
import type { Logger } from './pool.js';

export interface PostgresLikeError {
  code?: string;
  message?: string;
  detail?: string;
  where?: string;
  hint?: string;
}

/**
 * Sanitizes Postgres error messages by:
 * 1. Removing any `Key (...)=(...)` text to prevent row data leakage
 * 2. Removing DETAIL or WHERE fragments
 * 3. Truncating to 300 characters
 */
export function sanitizeMessage(rawMsg: string): string {
  let msg = rawMsg;

  // Remove Key (...)=(...) pattern (leaks values from unique constraints)
  msg = msg.replace(/Key \([^)]+\)=\([^)]+\)/gi, 'Key (...)');

  // Remove DETAIL: or WHERE: lines
  msg = msg.replace(/\bDETAIL:.*$/gim, '');
  msg = msg.replace(/\bWHERE:.*$/gim, '');

  // Collapse multiple whitespaces/newlines and trim
  msg = msg.replace(/\s+/g, ' ').trim();

  // Truncate to 300 characters
  if (msg.length > 300) {
    msg = msg.slice(0, 297) + '...';
  }

  return msg;
}

/**
 * Maps PostgreSQL and connection errors to safe PgmoatError instances.
 */
export function mapPgError(
  err: unknown,
  budgets?: { max_query_ms?: number; lock_timeout_ms?: number },
  signal?: AbortSignal,
  logger?: Logger,
  sqlFingerprint?: string,
): PgmoatError {
  if (isPgmoatError(err)) {
    return err;
  }

  const pgErr = err as PostgresLikeError;
  const sqlState = pgErr.code;
  const message = pgErr.message ?? (err instanceof Error ? err.message : String(err));

  // 1. Query canceled (SQLSTATE 57014)
  if (sqlState === '57014' || message.includes('canceling statement due to statement timeout')) {
    if (signal?.aborted) {
      return new PgmoatError(
        'PGM-505',
        'Client canceled the request; query canceled',
        'canceled',
      );
    }
    return fail(
      'PGM-303',
      'Query exceeded max_query_ms or lock_timeout_ms and was canceled',
    );
  }

  // 2. Lock not available / lock timeout (SQLSTATE 55P03)
  if (sqlState === '55P03' || message.includes('canceling statement due to lock timeout')) {
    return fail('PGM-303', 'Query timed out waiting for table lock');
  }

  // 3. Read only transaction write attempt (SQLSTATE 25006 - defense-in-depth hit)
  if (sqlState === '25006' || message.includes('cannot execute in a read-only transaction')) {
    logger?.warn(
      `Defense-in-depth: read-only transaction blocked write (fingerprint: ${sqlFingerprint ?? 'none'})`,
    );
    return refuse('PGM-201', 'Statement type not allowed in read-only mode');
  }

  // 4. Connection errors
  const isConnErr =
    (sqlState && sqlState.startsWith('08')) ||
    sqlState === '57P01' || // admin_shutdown
    sqlState === '57P02' || // crash_shutdown
    sqlState === '57P03' || // cannot_connect_now
    message.includes('Connection terminated unexpectedly') ||
    message.includes('connection closed') ||
    message.includes('ECONNRESET') ||
    message.includes('ECONNREFUSED') ||
    message.includes('EPIPE');

  if (isConnErr) {
    return fail('PGM-504', 'Database connection lost');
  }

  // 5. General Postgres errors (42601 syntax, 42P01 undefined table, 42703 undefined column, etc.)
  const sanitized = sanitizeMessage(message);
  return new PgmoatError('PGM-506', sanitized, 'error');
}

