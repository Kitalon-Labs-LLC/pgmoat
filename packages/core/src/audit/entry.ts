import { PGMOAT_VERSION } from '../version.js';
import type { ErrorCode } from '../errors.js';
import type { RequestContext, AuditEntry } from '../types.js';

export interface RequestOutcome {
  status: 'success' | 'refused' | 'error' | 'canceled';
  errorCode?: ErrorCode | null;
  errorMessage?: string | null;
  rowsReturned?: number | null;
  rowsAffected?: number | null;
}

export interface EntryMeta {
  serverName?: string;
  budgetMaxRows: number;
  budgetMaxQueryMs: number;
  durationMs: number;
  unsafeRoleOverride?: boolean;
}

/**
 * Builds an unsealed AuditEntry from a RequestContext, RequestOutcome, and EntryMeta.
 * prev_hash, entry_hash, seq, and dropped_since_last are initialized to empty/0
 * and populated during sealing by the hash chain.
 */
export function buildEntry(
  ctx: RequestContext,
  outcome: RequestOutcome,
  meta: EntryMeta,
): AuditEntry {
  const rlsContext: Record<string, string> | null = ctx.rls
    ? Object.fromEntries(ctx.rls.entries)
    : null;

  return {
    request_id: ctx.requestId,
    instance_id: ctx.instanceId,
    seq: 0,
    ts: ctx.startedAt.toISOString(),
    transport: ctx.transport,
    protocol_version: ctx.protocolVersion ?? null,
    client_name: ctx.client.name ?? null,
    client_version: ctx.client.version ?? null,
    principal: ctx.principal.sub,
    trace_id: ctx.traceId ?? null,
    tool: ctx.tool,
    params: { ...ctx.params },
    sql_executed: ctx.sqlExecuted ?? null,
    sql_fingerprint: ctx.sqlFingerprint ?? null,
    rls_context: rlsContext,
    status: outcome.status,
    error_code: outcome.errorCode ?? null,
    error_message: outcome.errorMessage ?? null,
    warnings: [...ctx.warnings],
    rows_returned: outcome.rowsReturned ?? ctx.rowsReturned ?? null,
    rows_affected: outcome.rowsAffected ?? null,
    duration_ms: Math.round(meta.durationMs),
    budget_max_rows: meta.budgetMaxRows,
    budget_max_query_ms: meta.budgetMaxQueryMs,
    payload_bytes: ctx.payloadBytes ?? null,
    prev_hash: '',
    entry_hash: '',
    dropped_since_last: 0,
    unsafe_role_override: meta.unsafeRoleOverride ?? false,
    pgmoat_version: PGMOAT_VERSION,
    server_name: meta.serverName ?? 'pgmoat',
  };
}

