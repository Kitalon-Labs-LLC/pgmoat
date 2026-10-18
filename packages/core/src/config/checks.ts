import { PgmoatError, refuse } from '../errors.js';
import type { PgmoatConfigT } from './schema.js';
import type { SchemaSnapshot } from '../types.js';

export interface CheckConfigOptions {
  strict?: boolean;
}

export interface CheckConfigResult {
  errors: PgmoatError[];
  warnings: PgmoatError[];
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export function checkConfig(
  config: PgmoatConfigT,
  options: CheckConfigOptions = {},
): CheckConfigResult {
  const errors: PgmoatError[] = [];
  const warnings: PgmoatError[] = [];
  const strict = options.strict ?? false;

  // PGM-102: mode: scoped-write is not available in v1.0
  if (config.mode === 'scoped-write') {
    errors.push(
      refuse(
        'PGM-102',
        'Scoped writes arrive in v1.1; use mode: read-only in v1.0',
      ),
    );
  }

  // PGM-103: update_columns non-empty requires update in write
  for (const [tableName, table] of Object.entries(config.tables)) {
    if (table.update_columns.length > 0 && !table.write.includes('update')) {
       
      const msg = `Table "${tableName}" specifies update_columns but does not include "update" in write operations`;
      errors.push(refuse('PGM-103', msg));
    }
  }

  // PGM-105: rls.required: true requires at least one session_variables entry
  if (
    config.rls.required &&
    Object.keys(config.rls.session_variables).length === 0
  ) {
    errors.push(
      refuse(
        'PGM-105',
        'rls.required is true but no session_variables are configured',
      ),
    );
  }

  // PGM-106: pool.max < pool.min
  if (config.connection.pool.max < config.connection.pool.min) {
    errors.push(
      refuse(
        'PGM-106',
        `Connection pool max (${config.connection.pool.max}) is below min (${config.connection.pool.min})`,
      ),
    );
  }

  // PGM-111: audit.destination: stdout with transport: stdio
  if (config.audit.destination === 'stdout' && config.transport === 'stdio') {
    errors.push(
      refuse(
        'PGM-111',
        'Cannot use stdout audit destination with stdio transport',
      ),
    );
  }

  // Check RLS sources
  const rlsSources = Object.values(config.rls.session_variables);

  // PGM-112: Any meta.* RLS source unless transport: stdio and rls.trust_request_meta: true
  const hasMetaSource = rlsSources.some((src) => src.startsWith('meta.'));
  if (
    hasMetaSource &&
    (config.transport !== 'stdio' || !config.rls.trust_request_meta)
  ) {
    errors.push(
      refuse(
        'PGM-112',
        'meta.* RLS sources are only allowed with stdio transport and rls.trust_request_meta: true',
      ),
    );
  }

  // PGM-113: Any token.* RLS source unless transport: http and auth.mode: oauth
  const hasTokenSource = rlsSources.some((src) => src.startsWith('token.'));
  if (
    hasTokenSource &&
    (config.transport !== 'http' ||
      !config.auth ||
      config.auth.mode !== 'oauth')
  ) {
    errors.push(
      refuse(
        'PGM-113',
        'token.* RLS sources require transport: http with auth.mode: oauth',
      ),
    );
  }

  // PGM-114: transport: http with a non-loopback http.host and (auth absent or auth.mode: none)
  if (config.transport === 'http') {
    const isLoopback = LOOPBACK_HOSTS.has(config.http.host.toLowerCase());
    const hasAuth = config.auth && config.auth.mode !== 'none';
    if (!isLoopback && !hasAuth) {
      errors.push(
        refuse(
          'PGM-114',
          `HTTP server bound to public host "${config.http.host}" without authentication`,
        ),
      );
    }
  }

  // OAuth checks
  if (config.auth && config.auth.mode === 'oauth') {
    // PGM-116: auth.mode: oauth missing issuer, audience, jwks_url, or http.public_url
    if (
      !config.auth.issuer ||
      !config.auth.audience ||
      !config.auth.jwks_url ||
      !config.http.public_url
    ) {
      errors.push(
        refuse(
          'PGM-116',
          'OAuth authentication requires issuer, audience, jwks_url, and http.public_url',
        ),
      );
    } else if (config.auth.audience !== config.http.public_url) {
      // PGM-117: auth.audience not equal to http.public_url (warning unless strict)
      const err = refuse(
        'PGM-117',
        `Token audience "${config.auth.audience}" does not match public URL "${config.http.public_url}"`,
      );
      if (strict) {
        errors.push(err);
      } else {
        warnings.push(err);
      }
    }
  }

  return { errors, warnings };
}

export function checkAgainstSchema(
  _config: PgmoatConfigT,
  _snapshot: SchemaSnapshot,
): CheckConfigResult {
  void _config;
  void _snapshot;
  // Post-introspection rules are implemented in Phase P6.1
  throw new Error('checkAgainstSchema is implemented in Phase P6.1');
}
