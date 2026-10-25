import type { IncomingMessage } from 'node:http';
import {
  createRemoteJWKSet,
  jwtVerify,
} from 'jose';

type KeyInput = Parameters<typeof jwtVerify>[1];
import { generateUlid } from '../tools/context.js';
import { PGMOAT_VERSION } from '../version.js';
import type { Principal, AuditEntry } from '../types.js';
import type { PgmoatConfigT } from '../config/schema.js';
import type { Runtime } from '../runtime.js';
import { getPrmUrl } from './prm.js';

export interface AuthSuccess {
  readonly ok: true;
  readonly principal: Principal;
}

export interface AuthFailure {
  readonly ok: false;
  readonly status: 401 | 403;
  readonly code: 'PGM-601' | 'PGM-602';
  readonly message: string;
  readonly wwwAuthenticate: string;
}

export type AuthResult = AuthSuccess | AuthFailure;

// Cache remote JWKS instances by URL to avoid recreating per request
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getOrCreateRemoteJWKSet(url: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url), { cooldownDuration: 30_000 });
    jwksCache.set(url, jwks);
  }
  return jwks;
}

/**
 * Extracts the bearer token strictly from the Authorization header.
 * Query string tokens are explicitly ignored per spec.
 */
export function extractBearerToken(req: IncomingMessage): string | null {
  const authHeader = req.headers['authorization'];
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match || !match[1]) {
    return null;
  }

  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * Extracts scopes from a JWT claims payload (supports `scope` space-separated string
 * and `scp` string or array of strings).
 */
export function extractScopes(payload: Record<string, unknown>): Set<string> {
  const scopes = new Set<string>();

  if (typeof payload['scope'] === 'string') {
    for (const part of payload['scope'].split(' ')) {
      const trimmed = part.trim();
      if (trimmed) scopes.add(trimmed);
    }
  }

  const scp = payload['scp'];
  if (Array.isArray(scp)) {
    for (const item of scp) {
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (trimmed) scopes.add(trimmed);
      }
    }
  } else if (typeof scp === 'string') {
    for (const part of scp.split(' ')) {
      const trimmed = part.trim();
      if (trimmed) scopes.add(trimmed);
    }
  }

  return scopes;
}

/**
 * Authenticates an incoming HTTP request using OAuth 2.0 Bearer JWT verification.
 * Spec reference: spec/03 section 10.4; spec/02 F15; MCP authorization spec
 */
export async function authenticate(
  req: IncomingMessage,
  config: PgmoatConfigT,
  customKeySet?: KeyInput,
): Promise<AuthResult> {
  // If auth is absent or mode is none, grant local access
  if (!config.auth || config.auth.mode === 'none') {
    return {
      ok: true,
      principal: {
        kind: 'local',
        sub: 'local',
        scopes: new Set<string>(),
        claims: {},
      },
    };
  }

  const publicUrl = config.http.public_url ?? `http://${config.http.host}:${config.http.port}`;
  const prmUrl = getPrmUrl(publicUrl);
  const requiredScopes = config.auth.required_scopes;
  const scopeHeaderVal = requiredScopes.join(' ');

  // 1. Extract Bearer token from Authorization header only
  const token = extractBearerToken(req);
  if (!token) {
    return {
      ok: false,
      status: 401,
      code: 'PGM-601',
      message: 'Missing or malformed Authorization header with Bearer token',
      wwwAuthenticate: `Bearer resource_metadata="${prmUrl}", scope="${scopeHeaderVal}"`,
    };
  }

  // 2. Determine verification key/set and allowed algorithms
  const allowedAlgs = config.auth.algorithms.filter(
    (alg) => alg.toLowerCase() !== 'none',
  );
  if (allowedAlgs.length === 0) {
    allowedAlgs.push('RS256', 'ES256', 'EdDSA');
  }

  let keySet: KeyInput;
  if (customKeySet) {
    keySet = customKeySet;
  } else if (config.auth.jwks_url) {
    keySet = getOrCreateRemoteJWKSet(config.auth.jwks_url);
  } else {
    return {
      ok: false,
      status: 401,
      code: 'PGM-601',
      message: 'Authentication failed: no JWKS URL configured',
      wwwAuthenticate: `Bearer resource_metadata="${prmUrl}", scope="${scopeHeaderVal}"`,
    };
  }

  // 3. Verify JWT
  let payload: Record<string, unknown>;
  try {
    const verifyOptions: Record<string, unknown> = {
      algorithms: allowedAlgs,
      clockTolerance: config.auth.clock_tolerance_s,
    };
    if (config.auth.issuer) verifyOptions.issuer = config.auth.issuer;
    if (config.auth.audience) verifyOptions.audience = config.auth.audience;

    const verified = await jwtVerify(token, keySet, verifyOptions);
    payload = verified.payload as Record<string, unknown>;
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : 'Token verification failed';
    return {
      ok: false,
      status: 401,
      code: 'PGM-601',
      message: `Invalid or expired access token: ${reason}`,
      wwwAuthenticate: `Bearer resource_metadata="${prmUrl}", scope="${scopeHeaderVal}"`,
    };
  }

  // 4. Verify required scopes
  const tokenScopes = extractScopes(payload);
  const missingScopes = requiredScopes.filter((s) => !tokenScopes.has(s));
  if (missingScopes.length > 0) {
    return {
      ok: false,
      status: 403,
      code: 'PGM-602',
      message: `Token lacks required scope(s): ${missingScopes.join(', ')}`,
      wwwAuthenticate: `Bearer error="insufficient_scope", scope="${scopeHeaderVal}", resource_metadata="${prmUrl}"`,
    };
  }

  // 5. Success: return Principal
  const sub = typeof payload['sub'] === 'string' ? payload['sub'] : 'anonymous';
  return {
    ok: true,
    principal: {
      kind: 'token',
      sub,
      scopes: tokenScopes,
      claims: payload,
    },
  };
}

/**
 * Emits a tamper-evident audit log entry for an authentication failure.
 */
export async function emitAuthFailureAudit(
  runtime: Runtime,
  failure: AuthFailure,
  req: IncomingMessage,
): Promise<void> {
  const entry: AuditEntry = {
    request_id: generateUlid(),
    instance_id: runtime.instanceId,
    seq: 0,
    ts: new Date().toISOString(),
    transport: 'http',
    protocol_version: (req.headers['mcp-protocol-version'] as string) ?? null,
    client_name: null,
    client_version: null,
    principal: 'anonymous',
    trace_id: null,
    tool: 'auth',
    params: {},
    sql_executed: null,
    sql_fingerprint: null,
    rls_context: null,
    status: 'refused',
    error_code: failure.code,
    error_message: failure.message,
    warnings: [],
    rows_returned: null,
    rows_affected: null,
    duration_ms: 0,
    budget_max_rows: runtime.config.budgets.max_rows,
    budget_max_query_ms: runtime.config.budgets.max_query_ms,
    payload_bytes: null,
    prev_hash: '',
    entry_hash: '',
    dropped_since_last: 0,
    unsafe_role_override: runtime.allowUnsafeRole,
    pgmoat_version: PGMOAT_VERSION,
    server_name: runtime.config.server.name,
  };

  try {
    await runtime.audit.emit(entry);
  } catch (err) {
    runtime.logger.error({ err }, 'Failed to record auth audit entry');
  }
}
