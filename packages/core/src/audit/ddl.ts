/* eslint-disable pgmoat/no-sql-string-building */
// Documented lint exception: fixed DDL template with validated identifiers and quoted tenant key literal
import type pg from 'pg';

export const AUDIT_EXPECTED_COLUMNS = [
  'id',
  'request_id',
  'instance_id',
  'seq',
  'ts',
  'inserted_at',
  'transport',
  'protocol_version',
  'client_name',
  'client_version',
  'principal',
  'trace_id',
  'tool',
  'params',
  'sql_executed',
  'sql_fingerprint',
  'rls_context',
  'status',
  'error_code',
  'error_message',
  'warnings',
  'rows_returned',
  'rows_affected',
  'duration_ms',
  'budget_max_rows',
  'budget_max_query_ms',
  'payload_bytes',
  'prev_hash',
  'entry_hash',
  'dropped_since_last',
  'unsafe_role_override',
  'pgmoat_version',
  'server_name',
] as const;

export const AUDIT_INSERT_COLUMNS = [
  'request_id',
  'instance_id',
  'seq',
  'ts',
  'transport',
  'protocol_version',
  'client_name',
  'client_version',
  'principal',
  'trace_id',
  'tool',
  'params',
  'sql_executed',
  'sql_fingerprint',
  'rls_context',
  'status',
  'error_code',
  'error_message',
  'warnings',
  'rows_returned',
  'rows_affected',
  'duration_ms',
  'budget_max_rows',
  'budget_max_query_ms',
  'payload_bytes',
  'prev_hash',
  'entry_hash',
  'dropped_since_last',
  'unsafe_role_override',
  'pgmoat_version',
  'server_name',
] as const;

const IDENTIFIER_REGEX = /^[a-z_][a-z0-9_]*$/;
const SETTING_NAME_REGEX = /^[a-z_][a-z0-9_.]*$/;

export function validateIdentifier(name: string, label: string): string {
  if (!IDENTIFIER_REGEX.test(name)) {
    throw new Error(`Invalid ${label} identifier: "${name}". Must match ^[a-z_][a-z0-9_]*$`);
  }
  return name;
}

export function validateSettingName(name: string): string {
  if (!SETTING_NAME_REGEX.test(name)) {
    throw new Error(`Invalid Postgres setting name: "${name}". Must match ^[a-z_][a-z0-9_.]*$`);
  }
  return name;
}

export function escapeLiteral(val: string): string {
  return val.replace(/'/g, "''");
}

export function getAuditDdl(
  schema = 'pgmoat',
  table = 'audit',
  tenantKey = 'app.tenant_id',
): string {
  const s = validateIdentifier(schema, 'schema');
  const t = validateIdentifier(table, 'table');
  const tk = escapeLiteral(validateSettingName(tenantKey));

  return `-- pgmoat audit schema, version 1. Additive changes only in minor releases.
CREATE SCHEMA IF NOT EXISTS ${s};

CREATE TABLE IF NOT EXISTS ${s}.${t} (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- identity and ordering
    request_id          TEXT        NOT NULL,
    instance_id         TEXT        NOT NULL,
    seq                 BIGINT      NOT NULL,
    ts                  TIMESTAMPTZ NOT NULL,
    inserted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- caller
    transport           TEXT        NOT NULL CHECK (transport IN ('stdio', 'http')),
    protocol_version    TEXT,
    client_name         TEXT,
    client_version      TEXT,
    principal           TEXT        NOT NULL,
    trace_id            TEXT,

    -- call
    tool                TEXT        NOT NULL,
    params              JSONB       NOT NULL DEFAULT '{}'::jsonb,
    sql_executed        TEXT,
    sql_fingerprint     TEXT,
    rls_context         JSONB,

    -- outcome
    status              TEXT        NOT NULL CHECK (status IN ('success', 'refused', 'error', 'canceled')),
    error_code          TEXT,
    error_message       TEXT,
    warnings            TEXT[]      NOT NULL DEFAULT '{}',
    rows_returned       INTEGER,
    rows_affected       INTEGER,
    duration_ms         INTEGER     NOT NULL,

    -- budgets
    budget_max_rows     INTEGER     NOT NULL,
    budget_max_query_ms INTEGER     NOT NULL,
    payload_bytes       INTEGER,

    -- integrity
    prev_hash           TEXT        NOT NULL,
    entry_hash          TEXT        NOT NULL,
    dropped_since_last  INTEGER     NOT NULL DEFAULT 0,
    unsafe_role_override BOOLEAN    NOT NULL DEFAULT false,

    -- provenance
    pgmoat_version      TEXT        NOT NULL,
    server_name         TEXT        NOT NULL,

    CONSTRAINT audit_instance_seq_uniq UNIQUE (instance_id, seq)
);

CREATE INDEX IF NOT EXISTS audit_ts_idx           ON ${s}.${t} (ts DESC);
CREATE INDEX IF NOT EXISTS audit_tenant_ts_idx    ON ${s}.${t} ((rls_context ->> '${tk}'), ts DESC);
CREATE INDEX IF NOT EXISTS audit_principal_ts_idx ON ${s}.${t} (principal, ts DESC);
CREATE INDEX IF NOT EXISTS audit_not_success_idx  ON ${s}.${t} (status, ts DESC) WHERE status <> 'success';
CREATE INDEX IF NOT EXISTS audit_error_code_idx   ON ${s}.${t} (error_code) WHERE error_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_fingerprint_idx  ON ${s}.${t} (sql_fingerprint, ts DESC) WHERE sql_fingerprint IS NOT NULL;

COMMENT ON TABLE  ${s}.${t} IS 'pgmoat audit log: one row per MCP tool call. Hash-chained per instance_id. Schema version 1.';
COMMENT ON COLUMN ${s}.${t}.entry_hash IS 'sha256(prev_hash || newline || canonical JSON of the entry without entry_hash)';
COMMENT ON COLUMN ${s}.${t}.client_name IS 'Self-reported by the MCP client. Not verified. Do not use for security decisions.';
`;
}

/**
 * Checks if the audit table exists and has all required columns.
 */
export async function verifyAuditTable(
  client: pg.Pool | pg.ClientBase,
  schema = 'pgmoat',
  table = 'audit',
): Promise<boolean> {
  const result = await client.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2`,
    [schema, table],
  );

  const existingColumns = new Set(result.rows.map((r) => r.column_name));
  for (const col of AUDIT_EXPECTED_COLUMNS) {
    if (!existingColumns.has(col)) {
      return false;
    }
  }
  return true;
}

export interface EnsureAuditTableOptions {
  schema?: string;
  table?: string;
  tenantKey?: string;
  createSchema?: boolean;
}

/**
 * Ensures the audit table is created or verified on Postgres startup.
 */
export async function ensureAuditTable(
  client: pg.Pool | pg.ClientBase,
  options?: EnsureAuditTableOptions,
): Promise<void> {
  const schema = options?.schema ?? 'pgmoat';
  const table = options?.table ?? 'audit';
  const tenantKey = options?.tenantKey ?? 'app.tenant_id';
  const createSchema = options?.createSchema ?? true;

  const ddl = getAuditDdl(schema, table, tenantKey);

  if (createSchema) {
    try {
      await client.query(ddl);
      return;
    } catch {
      // Role may lack CREATE privileges; verify if table already exists
      const isValid = await verifyAuditTable(client, schema, table);
      if (isValid) {
        return;
      }
    }
  }

  // If createSchema was false or DDL execution failed:
  const valid = await verifyAuditTable(client, schema, table);
  if (!valid) {
    throw new Error(
      `Audit table "${schema}.${table}" does not exist or has missing columns.\n` +
      `Run the following DDL with an admin role:\n\n${ddl}`,
    );
  }
}

