import { refuse } from '../errors.js';
import type { ResolvedRls } from '../types.js';
import type { PgmoatConfigT } from '../config/schema.js';

export const META_RLS_KEY = 'com.kitalonlabs.pgmoat/rls';

export interface ResolveRlsInput {
  rls: PgmoatConfigT['rls'];
  transport: 'stdio' | 'http';
  principal?: {
    kind?: 'local' | 'token';
    sub?: string;
    scopes?: ReadonlySet<string>;
    claims?: Readonly<Record<string, unknown>>;
  } | null;
  meta?: Readonly<Record<string, unknown>> | null;
  env?: Record<string, string | undefined>;
}

function getNestedClaim(
  obj: Readonly<Record<string, unknown>> | undefined,
  path: string,
): unknown {
  if (!obj) return undefined;
  const parts = path.split('.');
  let curr: unknown = obj;
  for (const part of parts) {
    if (curr === null || typeof curr !== 'object' || Array.isArray(curr)) {
      return undefined;
    }
    // eslint-disable-next-line security/detect-object-injection
    curr = (curr as Record<string, unknown>)[part];
  }
  return curr;
}

/**
 * Pure function resolving session variables per request from trusted sources,
 * enforcing scalar types, non-empty values, and required constraints.
 */
export function resolveRls(input: ResolveRlsInput): ResolvedRls {
  const { rls, transport, principal, meta, env = process.env } = input;

  // Check untrusted request meta
  // eslint-disable-next-line security/detect-object-injection -- fixed constant string key
  const metaRls = meta?.[META_RLS_KEY];
  const isMetaTrusted = transport === 'stdio' && rls.trust_request_meta;

  if (metaRls !== undefined) {
    if (!isMetaTrusted) {
      throw refuse(
        'PGM-404',
        'Request supplied RLS meta that this server does not trust',
      );
    }
    if (
      typeof metaRls !== 'object' ||
      metaRls === null ||
      Array.isArray(metaRls)
    ) {
      throw refuse(
        'PGM-403',
        `Meta payload for ${META_RLS_KEY} must be an object`,
      );
    }
  }

  const entries: [string, string][] = [];
  const sources: Record<string, 'token' | 'env' | 'static' | 'meta'> = {};

  const sessionVars = Object.entries(rls.session_variables ?? {});

  for (const [settingName, sourceSpec] of sessionVars) {
    let rawValue: unknown;
    let sourceType: 'token' | 'env' | 'static' | 'meta';

    if (sourceSpec.startsWith('static:')) {
      sourceType = 'static';
      rawValue = sourceSpec.slice('static:'.length);
    } else if (sourceSpec.startsWith('env.')) {
      sourceType = 'env';
      const envKey = sourceSpec.slice('env.'.length);
      // eslint-disable-next-line security/detect-object-injection
      rawValue = env[envKey];
    } else if (sourceSpec.startsWith('token.')) {
      sourceType = 'token';
      const claimPath = sourceSpec.slice('token.'.length);
      rawValue = getNestedClaim(principal?.claims, claimPath);
    } else if (sourceSpec.startsWith('meta.')) {
      sourceType = 'meta';
      const metaKey = sourceSpec.slice('meta.'.length);
      if (metaRls && typeof metaRls === 'object') {
        // eslint-disable-next-line security/detect-object-injection
        rawValue = (metaRls as Record<string, unknown>)[metaKey];
      }
    } else {
      continue;
    }

    // Handle missing value
    if (rawValue === undefined || rawValue === null) {
      if (rls.required) {
        if (sourceType === 'token') {
          throw refuse(
            'PGM-405',
            `Token lacks the configured claim: ${sourceSpec}`,
          );
        }
        throw refuse(
          'PGM-401',
          `Required RLS value missing for "${settingName}" via source: ${sourceSpec}`,
        );
      }
      // Not required: skip
      continue;
    }

    // Scalar check: must be string, number, or boolean
    if (
      typeof rawValue !== 'string' &&
      typeof rawValue !== 'number' &&
      typeof rawValue !== 'boolean'
    ) {
      throw refuse(
        'PGM-403',
        `RLS value for "${settingName}" must be a scalar, got ${typeof rawValue}`,
      );
    }

    const strValue = String(rawValue);

    // Empty string check
    if (strValue.trim().length === 0) {
      throw refuse(
        'PGM-403',
        `RLS value for "${settingName}" cannot be empty`,
      );
    }

    entries.push([settingName, strValue]);
    // eslint-disable-next-line security/detect-object-injection
    sources[settingName] = sourceType;
  }

  return {
    entries,
    sources,
  };
}
