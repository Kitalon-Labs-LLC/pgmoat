import * as libpgQuery from 'libpg-query';
import { deparseSync } from 'pgsql-deparser';
import type { AuditEntry } from '../types.js';
import type { AuditConfigT } from '../config/schema.js';
import { walk } from '../safety/walk.js';

export const DEFAULT_REDACT_FIELDS = [
  'password',
  'passwd',
  'secret',
  'token',
  'api_key',
  'apikey',
  'ssn',
  'fein',
  'card_number',
  'credit_card',
  'cvv',
  'iban',
];

export const DEFAULT_REDACT_PATTERNS = ['\\b\\d{3}-\\d{2}-\\d{4}\\b'];

function isRedactedKey(key: string, redactFields: readonly string[]): boolean {
  const lowerKey = key.toLowerCase();
  return redactFields.some((field) => lowerKey.includes(field.toLowerCase()));
}

function redactValuesRecursively(
  val: unknown,
  redactFields: readonly string[],
): unknown {
  if (val === null || val === undefined) {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map((item) => redactValuesRecursively(item, redactFields));
  }
  if (typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      if (isRedactedKey(k, redactFields)) {
        // eslint-disable-next-line security/detect-object-injection
        out[k] = '[REDACTED]';
      } else {
        // eslint-disable-next-line security/detect-object-injection
        out[k] = redactValuesRecursively(v, redactFields);
      }
    }
    return out;
  }
  return val;
}

function getColumnName(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const colRef = (node as Record<string, unknown>).ColumnRef as
    | { fields?: unknown[] }
    | undefined;
  if (!colRef || !Array.isArray(colRef.fields) || colRef.fields.length === 0) {
    return null;
  }
  const lastField = colRef.fields[colRef.fields.length - 1] as
    | Record<string, unknown>
    | undefined;
  if (!lastField || typeof lastField !== 'object') return null;
  const str = (lastField as { String?: { sval?: string } }).String;
  return str?.sval ?? null;
}

function redactAConst(target: Record<string, unknown>, key: string): void {
  // eslint-disable-next-line security/detect-object-injection
  const current = target[key] as Record<string, unknown> | undefined;
  if (current && typeof current === 'object' && 'A_Const' in current) {
    // eslint-disable-next-line security/detect-object-injection
    target[key] = { A_Const: { sval: { sval: '[REDACTED]' } } };
  } else if (current && typeof current === 'object' && 'List' in current) {
    const list = current.List as { items?: unknown[] } | undefined;
    if (list && Array.isArray(list.items)) {
      list.items = list.items.map((item) => {
        if (item && typeof item === 'object' && 'A_Const' in item) {
          return { A_Const: { sval: { sval: '[REDACTED]' } } };
        }
        return item;
      });
    }
  }
}

/**
 * Synchronously redacts secrets from an AuditEntry:
 * 1. Sensitive keys in params and rls_context
 * 2. SQL literals associated with sensitive columns
 * 3. Regular expression patterns in sql_executed and error_message
 */
export function redactEntrySync(
  entry: AuditEntry,
  auditConfig?: Partial<AuditConfigT>,
): AuditEntry {
  const redactFields = auditConfig?.redact_fields ?? DEFAULT_REDACT_FIELDS;
  const redactPatterns = auditConfig?.redact_patterns ?? DEFAULT_REDACT_PATTERNS;
  const redactInSql = auditConfig?.redact_in_sql ?? true;

  const result: AuditEntry = {
    ...entry,
    params: (redactValuesRecursively(entry.params, redactFields) ?? {}) as Record<
      string,
      unknown
    >,
    rls_context: entry.rls_context
      ? ((redactValuesRecursively(entry.rls_context, redactFields) ?? {}) as Record<
          string,
          string
        >)
      : null,
  };

  // 2. SQL literal redaction
  if (result.sql_executed && redactInSql) {
    try {
      const parsed = libpgQuery.parseSync(result.sql_executed);
      walk(parsed, (node, type) => {
        if (type === 'A_Expr') {
          const expr = node as {
            lexpr?: Record<string, unknown>;
            rexpr?: Record<string, unknown>;
          };
          const leftCol = getColumnName(expr.lexpr);
          const rightCol = getColumnName(expr.rexpr);

          if (leftCol && isRedactedKey(leftCol, redactFields)) {
            redactAConst(expr as Record<string, unknown>, 'rexpr');
          } else if (rightCol && isRedactedKey(rightCol, redactFields)) {
            redactAConst(expr as Record<string, unknown>, 'lexpr');
          }
        } else if (type === 'ResTarget') {
          const target = node as {
            name?: string;
            val?: Record<string, unknown>;
          };
          if (target.name && isRedactedKey(target.name, redactFields)) {
            redactAConst(target as Record<string, unknown>, 'val');
          }
        }
      });

      result.sql_executed = deparseSync(parsed);
    } catch {
      result.sql_executed = '[REDACTED: unparseable]';
    }
  }

  // 3. Pattern redaction on sql_executed and error_message
  if (redactPatterns.length > 0) {
    const compiled = redactPatterns
      .filter((p) => p.length <= 500)
      // eslint-disable-next-line security/detect-non-literal-regexp -- length-bounded audit patterns
      .map((p) => new RegExp(p, 'g'));

    for (const regex of compiled) {
      if (result.sql_executed) {
        result.sql_executed = result.sql_executed.replace(regex, '[REDACTED]');
      }
      if (result.error_message) {
        result.error_message = result.error_message.replace(regex, '[REDACTED]');
      }
    }
  }

  return result;
}

/**
 * Async wrapper for redactEntrySync.
 */
export async function redactEntry(
  entry: AuditEntry,
  auditConfig?: Partial<AuditConfigT>,
): Promise<AuditEntry> {
  return redactEntrySync(entry, auditConfig);
}
