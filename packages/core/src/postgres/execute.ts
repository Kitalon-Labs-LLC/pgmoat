import pg from 'pg';
import Cursor from 'pg-cursor';
import { acquire, type Pools, type Logger } from './pool.js';
import { mapPgError } from './errors.js';
import type { ResolvedRls, ExecResult } from '../types.js';

export interface ExecuteBudgets {
  max_rows: number;
  max_query_ms: number;
  lock_timeout_ms: number;
}

export interface ExecuteOptions {
  logger?: Logger;
  sqlFingerprint?: string;
}

const COMMON_OID_TYPES: Record<number, string> = {
  16: 'bool',
  18: 'char',
  19: 'name',
  20: 'int8',
  21: 'int2',
  23: 'int4',
  25: 'text',
  114: 'json',
  142: 'xml',
  700: 'float4',
  701: 'float8',
  1042: 'bpchar',
  1043: 'varchar',
  1082: 'date',
  1083: 'time',
  1114: 'timestamp',
  1184: 'timestamptz',
  1700: 'numeric',
  2950: 'uuid',
  3802: 'jsonb',
};

const oidCache = new Map<number, string>(
  Object.entries(COMMON_OID_TYPES).map(([k, v]) => [Number(k), v]),
);

/**
 * Resolves PostgreSQL OID to type name, using cache and falling back to querying pg_type.
 */
export async function resolveFieldTypes(
  rawFields: { name: string; dataTypeID: number }[],
  client?: pg.ClientBase,
): Promise<{ name: string; dataTypeId: number; typeName: string }[]> {
  const result: { name: string; dataTypeId: number; typeName: string }[] = [];
  const missingOids: number[] = [];

  for (const field of rawFields) {
    const cached = oidCache.get(field.dataTypeID);
    if (!cached && !missingOids.includes(field.dataTypeID)) {
      missingOids.push(field.dataTypeID);
    }
  }

  if (missingOids.length > 0 && client) {
    try {
      const typeRes = await client.query<{ oid: number; typname: string }>(
        'SELECT oid, typname FROM pg_type WHERE oid = ANY($1::oid[])',
        [missingOids],
      );
      for (const row of typeRes.rows) {
        oidCache.set(Number(row.oid), row.typname);
      }
    } catch {
      // Fallback silently if pg_type lookup fails
    }
  }

  for (const field of rawFields) {
    const typeName = oidCache.get(field.dataTypeID) ?? `oid_${field.dataTypeID}`;
    result.push({
      name: field.name,
      dataTypeId: field.dataTypeID,
      typeName,
    });
  }

  return result;
}

/**
 * Runs one read-only statement inside BEGIN READ ONLY with transaction-local limits and RLS,
 * fetching at most max_rows + 1 rows through pg-cursor.
 */
export async function executeRead(
  pools: Pools,
  sql: string,
  rls: ResolvedRls | null | undefined,
  budgets: ExecuteBudgets,
  signal?: AbortSignal,
  options?: ExecuteOptions,
): Promise<ExecResult> {
  const client = await acquire(pools.query, budgets.max_query_ms);
  let broken = false;

  const onAbort = () => {
    // ProcessID is a property of pg.Client at runtime
    const pid = (client as unknown as { processID?: number }).processID;
    if (pid) {
      void pools.control.cancelBackend(pid);
    }
  };

  if (signal) {
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    }
  }

  try {
    await client.query('BEGIN READ ONLY');

    const idleTimeoutMs = budgets.max_query_ms + 1000;
    await client.query(
      `SELECT set_config('statement_timeout', $1, true),
              set_config('lock_timeout', $2, true),
              set_config('idle_in_transaction_session_timeout', $3, true)`,
      [
        String(budgets.max_query_ms),
        String(budgets.lock_timeout_ms),
        String(idleTimeoutMs),
      ],
    );

    if (rls?.entries) {
      for (const [name, value] of rls.entries) {
        await client.query('SELECT set_config($1, $2, true)', [name, value]);
      }
    }

    const cursor = client.query(new Cursor(sql));
    const started = performance.now();
    const readLimit = budgets.max_rows + 1;

    const { rows, result } = await new Promise<{
      rows: Record<string, unknown>[];
      result?: pg.QueryResult;
    }>((resolve, reject) => {
      cursor.read(readLimit, (err, readRows, queryRes) => {
        if (err) return reject(err);
        resolve({
          rows: (readRows ?? []) as Record<string, unknown>[],
          result: queryRes,
        });
      });
    });

    const rawFields =
      result?.fields ??
      (cursor as unknown as { _result?: { fields?: pg.FieldDef[] } })._result
        ?.fields ??
      [];

    await cursor.close();
    const durationMs = performance.now() - started;
    await client.query('COMMIT');

    const truncatedByRowCap = rows.length > budgets.max_rows;
    const fields = await resolveFieldTypes(rawFields, client);

    return {
      rows,
      fields,
      durationMs,
      truncatedByRowCap,
    };
  } catch (err: unknown) {
    broken = true;
    await client.query('ROLLBACK').catch(() => {});
    throw mapPgError(
      err,
      budgets,
      signal,
      options?.logger,
      options?.sqlFingerprint,
    );
  } finally {
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
    client.release(broken ? true : undefined);
  }
}

