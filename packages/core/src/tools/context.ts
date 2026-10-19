/* eslint-disable security/detect-object-injection */
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import type {
  Principal,
  RequestContext,
  ToolName,
  Transport,
  AuditEntry,
} from '../types.js';
import type { PgmoatConfigT } from '../config/schema.js';
import type { AuditPipeline } from '../audit/pipeline.js';
import type { SchemaCache } from '../schema/cache.js';
import type { Pools } from '../postgres/pool.js';

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generates a 26-character ULID (48-bit timestamp + 80-bit randomness in Crockford Base32).
 */
export function generateUlid(now = Date.now()): string {
  let timeStr = '';
  let time = now;
  for (let i = 9; i >= 0; i--) {
    timeStr = CROCKFORD_BASE32[time % 32] + timeStr;
    time = Math.floor(time / 32);
  }

  const randBytes = crypto.randomBytes(10);
  let randStr = '';
  let big = BigInt('0x' + randBytes.toString('hex'));
  for (let i = 0; i < 16; i++) {
    randStr = CROCKFORD_BASE32[Number(big & 31n)] + randStr;
    big >>= 5n;
  }

  return timeStr + randStr;
}

/**
 * Parses W3C traceparent (version-traceid-parentid-traceflags).
 * Returns the 32-character hex traceId, or null if invalid or all zeros.
 */
export function parseTraceId(traceparent: unknown): string | null {
  if (typeof traceparent !== 'string') return null;
  const match = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec(
    traceparent.trim(),
  );
  if (!match) return null;
  const traceId = match[2]?.toLowerCase();
  if (!traceId || traceId === '00000000000000000000000000000000') {
    return null;
  }
  return traceId;
}

/**
 * AsyncLocalStorage for request principal (used in HTTP auth).
 */
export const principalStorage = new AsyncLocalStorage<Principal>();

export interface ToolDeps {
  readonly config: PgmoatConfigT;
  readonly audit: AuditPipeline | { emit: (entry: AuditEntry) => void | Promise<void> };
  readonly instanceId: string;
  readonly transport?: Transport;
  readonly unsafeRoleOverride?: boolean;
  readonly schemaCache?: SchemaCache;
  readonly pools?: Pools;
  readonly pool?: unknown;
}

export interface McpContextLike {
  readonly sessionId?: string;
  readonly mcpReq?: {
    readonly id?: string | number;
    readonly method?: string;
    readonly _meta?: Record<string, unknown>;
    readonly envelope?: {
      readonly 'io.modelcontextprotocol/protocol-version'?: string;
      readonly protocolVersion?: string;
      readonly 'io.modelcontextprotocol/client-info'?: {
        name?: string;
        version?: string;
      };
      readonly clientInfo?: {
        name?: string;
        version?: string;
      };
      readonly [key: string]: unknown;
    };
    readonly signal?: AbortSignal;
    readonly [key: string]: unknown;
  };
  readonly http?: unknown;
  readonly [key: string]: unknown;
}

/**
 * Builds a RequestContext from MCP handler context, tool arguments, and runtime dependencies.
 */
export function createRequestContext(
  tool: ToolName,
  args: unknown,
  ctx: unknown,
  deps: ToolDeps,
): RequestContext {
  const mcpCtx = (ctx && typeof ctx === 'object' ? ctx : {}) as McpContextLike;
  const mcpReq = mcpCtx.mcpReq ?? (ctx as McpContextLike['mcpReq']) ?? {};

  const rawMeta = (mcpReq._meta ?? {}) as Record<string, unknown>;
  const nonReservedMeta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawMeta)) {
    const lower = key.toLowerCase();
    if (!lower.startsWith('io.modelcontextprotocol/') && !lower.startsWith('mcp/')) {
      nonReservedMeta[key] = value;
    }
  }

  const envelope = mcpReq.envelope;
  const protocolVersion =
    envelope?.['io.modelcontextprotocol/protocol-version'] ??
    envelope?.protocolVersion ??
    null;

  const clientInfo =
    envelope?.['io.modelcontextprotocol/client-info'] ??
    envelope?.clientInfo ??
    null;

  const traceId =
    parseTraceId(rawMeta['traceparent']) ??
    parseTraceId(rawMeta['com.kitalonlabs.pgmoat/traceparent']);

  const principal = principalStorage.getStore() ?? {
    kind: 'local',
    sub: 'local',
    scopes: new Set<string>(),
    claims: {},
  };

  const transport = deps.transport ?? 'stdio';

  const params =
    args && typeof args === 'object'
      ? (args as Record<string, unknown>)
      : {};

  const signal = mcpReq.signal ?? new AbortController().signal;

  return {
    requestId: generateUlid(),
    instanceId: deps.instanceId,
    startedAt: new Date(),
    transport,
    protocolVersion,
    client: {
      name: clientInfo?.name ?? null,
      version: clientInfo?.version ?? null,
    },
    principal,
    traceId,
    tool,
    params,
    meta: nonReservedMeta,
    signal,
    rls: null,
    sqlExecuted: null,
    sqlFingerprint: null,
    warnings: [],
    rowsReturned: null,
    payloadBytes: null,
  };
}
