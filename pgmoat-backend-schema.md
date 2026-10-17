# Backend Schema: pgmoat

Doc owner: Sowad Al-Mughni (Kitalon Labs)
Status: Draft v2 (supersedes pgbridge Backend Schema v1)
Last updated: 2026-10-17
Companion docs: 01 PRD, 02 Feature Spec, 03 Technical Architecture, 04 TRD

pgmoat is a Postgres tool, so "backend schema" covers four contracts:

1. **Audit table DDL** (`pgmoat.audit`): the only DDL pgmoat ever writes, and only to the audit database.
2. **Runtime types**: the TypeScript shapes passed between subsystems.
3. **Config schema**: the Zod definition of `pgmoat.yaml` and its cross-field rules.
4. **Error code registry**: every `PGM-xxx` code with cause, HTTP mapping where relevant, and fix.

A hosted-edition control plane sketch closes the document; it is not part of v1.

This document is canonical. If the Feature Spec, Tech Arch, or code disagree with it on a field name, type, default, or code, this document wins and the others get fixed.

---

## 1) Audit table: `pgmoat.audit`

### 1.1 DDL (v1)

Applied idempotently at startup when `audit.destination: postgres`, using the audit connection (never the query connection). Additive changes only in minor releases.

```sql
-- pgmoat audit schema, version 1. Additive changes only in minor releases.
CREATE SCHEMA IF NOT EXISTS pgmoat;

CREATE TABLE IF NOT EXISTS pgmoat.audit (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- identity and ordering
    request_id          TEXT        NOT NULL,          -- ULID, one per tool call
    instance_id         TEXT        NOT NULL,          -- ULID, one per pgmoat process start
    seq                 BIGINT      NOT NULL,          -- monotonic per instance, starts at 0
    ts                  TIMESTAMPTZ NOT NULL,          -- when the tool call started (server clock)
    inserted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- caller
    transport           TEXT        NOT NULL CHECK (transport IN ('stdio', 'http')),
    protocol_version    TEXT,                          -- e.g. '2026-07-28' or '2025-11-25'
    client_name         TEXT,                          -- self-reported, display only
    client_version      TEXT,                          -- self-reported, display only
    principal           TEXT        NOT NULL,          -- token sub (http) or 'local' (stdio)
    trace_id            TEXT,                          -- from W3C traceparent, if present

    -- call
    tool                TEXT        NOT NULL,
    params              JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- redacted
    sql_executed        TEXT,                          -- after rewrite, redacted; null for non-SQL tools
    sql_fingerprint     TEXT,                          -- 16 hex chars; constants stripped
    rls_context         JSONB,                         -- {"app.tenant_id": "tnt_abc", ...}, redacted keys masked

    -- outcome
    status              TEXT        NOT NULL CHECK (status IN ('success', 'refused', 'error', 'canceled')),
    error_code          TEXT,                          -- PGM-xxx; null on success
    error_message       TEXT,                          -- sanitized
    warnings            TEXT[]      NOT NULL DEFAULT '{}',
    rows_returned       INTEGER,
    rows_affected       INTEGER,                       -- v1.1 writes
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

CREATE INDEX IF NOT EXISTS audit_ts_idx           ON pgmoat.audit (ts DESC);
CREATE INDEX IF NOT EXISTS audit_tenant_ts_idx    ON pgmoat.audit ((rls_context ->> 'app.tenant_id'), ts DESC);
CREATE INDEX IF NOT EXISTS audit_principal_ts_idx ON pgmoat.audit (principal, ts DESC);
CREATE INDEX IF NOT EXISTS audit_not_success_idx  ON pgmoat.audit (status, ts DESC) WHERE status <> 'success';
CREATE INDEX IF NOT EXISTS audit_error_code_idx   ON pgmoat.audit (error_code) WHERE error_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_fingerprint_idx  ON pgmoat.audit (sql_fingerprint, ts DESC) WHERE sql_fingerprint IS NOT NULL;

COMMENT ON TABLE  pgmoat.audit IS 'pgmoat audit log: one row per MCP tool call. Hash-chained per instance_id. Schema version 1.';
COMMENT ON COLUMN pgmoat.audit.entry_hash IS 'sha256(prev_hash || newline || canonical JSON of the entry without entry_hash)';
COMMENT ON COLUMN pgmoat.audit.client_name IS 'Self-reported by the MCP client. Not verified. Do not use for security decisions.';
```

The tenant index uses the key `app.tenant_id`. If the operator uses a different variable name, `audit.postgres.tenant_key` (default `app.tenant_id`) changes the expression index created at startup.

### 1.2 Recommended roles

```sql
CREATE ROLE pgmoat_audit LOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA pgmoat TO pgmoat_audit;
GRANT INSERT, SELECT ON pgmoat.audit TO pgmoat_audit;
-- No UPDATE or DELETE: entries are append-only. Retention runs as a separate admin job.
```

If the audit role lacks `CREATE` on the database, the operator runs the DDL once with an admin role; pgmoat detects the existing table and skips creation.

### 1.3 Retention

pgmoat does not delete Postgres audit rows itself (the audit role has no `DELETE`). Docs provide a `pg_cron` job example and a partitioning recipe (monthly partitions on `ts`). For the file destination, `pgmoat audit prune --older-than 90d` deletes rotated files.

### 1.4 What is not stored

- Result rows. Audit proves what was asked and what happened, not the data returned.
- Unredacted values for keys matching `redact_fields`.
- The agent's natural-language prompt (MCP does not give it to servers).
- Bearer tokens or any part of them.

### 1.5 NDJSON format (stderr and file destinations)

Same fields as the table except `id` and `inserted_at`, with snake_case keys, one JSON object per line, UTF-8:

```json
{"request_id":"01JAB3...","instance_id":"01JAB0...","seq":42,"ts":"2026-12-08T14:23:11.412Z","transport":"stdio","protocol_version":"2026-07-28","client_name":"claude-code","client_version":"2.9.1","principal":"local","trace_id":null,"tool":"query","params":{"sql":"SELECT count(*) FROM users WHERE deleted_at IS NULL"},"sql_executed":"SELECT count(*) FROM users WHERE deleted_at IS NULL LIMIT 201","sql_fingerprint":"9f1c2ab07d33e4c1","rls_context":{"app.tenant_id":"tnt_abc"},"status":"success","error_code":null,"error_message":null,"warnings":[],"rows_returned":1,"rows_affected":null,"duration_ms":31,"budget_max_rows":200,"budget_max_query_ms":5000,"payload_bytes":412,"prev_hash":"6b0e...","entry_hash":"c41d...","dropped_since_last":0,"unsafe_role_override":false,"pgmoat_version":"1.0.0","server_name":"acme-prod"}
```

### 1.6 Migration policy

| Version | Change |
|---|---|
| 1.0 | Initial schema above |
| 1.x | Add nullable columns only; new indexes allowed |
| 2.0 | Renames and drops allowed with a shipped migration (`pgmoat audit migrate --print` shows the SQL first) |

---

## 2) Runtime types (`packages/core/src/types.ts`)

```ts
export type Mode = 'read-only' | 'scoped-write';
export type Transport = 'stdio' | 'http';
export type Sensitivity = 'low' | 'medium' | 'high';
export type RelationKind = 'table' | 'partitioned_table' | 'view' | 'materialized_view' | 'foreign_table';

// ---------- schema snapshot ----------
export interface SchemaSnapshot {
  builtAt: Date;
  serverVersionNum: number;              // e.g. 180004
  relations: RelationInfo[];             // visible only, sorted by schema then name
  byQualifiedName: ReadonlyMap<string, RelationInfo>;   // 'public.users'
  hiddenCount: number;                   // hidden relations (count only)
  policyIndex: PolicyIndex;              // private: includes hidden names, used only by safety/policy.ts
}

export interface RelationInfo {
  schema: string;
  name: string;
  qualifiedName: string;
  kind: RelationKind;
  description: string;                   // annotation, else pg comment, else 'Unannotated'
  rowEstimate: number;                   // pg_class.reltuples (may be -1 if never analyzed)
  columns: ColumnInfo[];                 // visible only, ordinal order
  hiddenColumnCount: number;
  primaryKey: string[] | null;
  uniqueKeys: string[][];
  foreignKeys: ForeignKeyInfo[];
  referencedBy: { relation: string; columns: string[] }[];
  indexes: IndexInfo[];
  relationships: string[];               // annotation text
  rls: { enabled: boolean; forced: boolean };
  owner: string;
  write: WriteRules;                     // v1.1 scoped-write; empty in read-only
}

export interface ColumnInfo {
  name: string;
  type: string;                          // format_type output, e.g. 'timestamp with time zone'
  notNull: boolean;
  default: string | null;
  ordinal: number;
  description: string;
  sensitive: Sensitivity | null;
  untrusted: boolean;
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  references: { relation: string; columns: string[] };
  onDelete: 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT';
}

export interface IndexInfo { name: string; columns: string[]; unique: boolean; primary: boolean; definition: string }

export interface PolicyIndex {
  hiddenRelations: ReadonlySet<string>;                    // qualified names
  hiddenColumns: ReadonlyMap<string, ReadonlySet<string>>; // qualified relation -> hidden column names
  knownRelations: ReadonlySet<string>;                     // all relations in exposed schemas, hidden included
  exposedSchemas: readonly string[];
}

export interface WriteRules {
  ops: ('insert' | 'update' | 'delete')[];
  updateColumns: string[];
  insertRequiredColumns: string[];
  insertDefaults: Record<string, string | number | boolean | null>;
  maxAffectedRows: number;
}

// ---------- request ----------
export interface Principal {
  kind: 'local' | 'token';
  sub: string;                           // 'local' for stdio
  scopes: ReadonlySet<string>;
  claims: Readonly<Record<string, unknown>>;
}

export interface RequestContext {
  requestId: string;                     // ULID
  instanceId: string;
  startedAt: Date;
  transport: Transport;
  protocolVersion: string | null;
  client: { name: string | null; version: string | null };   // self-reported
  principal: Principal;
  traceId: string | null;
  tool: ToolName;
  params: Readonly<Record<string, unknown>>;
  meta: Readonly<Record<string, unknown>>;                   // non-reserved request _meta
  signal: AbortSignal;
  // filled as the request proceeds
  rls: ResolvedRls | null;
  sqlExecuted: string | null;
  sqlFingerprint: string | null;
  warnings: string[];
  rowsReturned: number | null;
  payloadBytes: number | null;
}

export type ToolName = 'describe_table' | 'explain' | 'list_tables' | 'query' | 'sample_table'
  | 'insert' | 'update' | 'delete';      // last three: v1.1

export interface ResolvedRls {
  entries: [name: string, value: string][];   // in config order
  sources: Record<string, 'token' | 'env' | 'static' | 'meta'>;
}

// ---------- safety ----------
export type SafetyResult =
  | { allowed: true; sql: string; fingerprint: string; limitInjected: boolean; statementType: 'select' | 'explain' | 'show' }
  | { allowed: false; code: ErrorCode; message: string; hint?: string; node?: string };

// ---------- execution ----------
export interface ExecResult {
  fields: { name: string; dataTypeId: number; typeName: string }[];
  rows: Record<string, unknown>[];
  durationMs: number;
  truncatedByRowCap: boolean;
}

// ---------- tool output (matches output/schemas.ts) ----------
export interface RowsResult {
  columns: { name: string; type: string; untrusted: boolean; masked?: boolean }[];
  rows: Record<string, JsonValue>[];
  row_count: number;
  truncated: boolean;
  warnings: { code: ErrorCode; message: string }[];
  request_id: string;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

// ---------- audit ----------
export interface AuditEntry {
  request_id: string;
  instance_id: string;
  seq: number;
  ts: string;
  transport: Transport;
  protocol_version: string | null;
  client_name: string | null;
  client_version: string | null;
  principal: string;
  trace_id: string | null;
  tool: string;
  params: Record<string, unknown>;
  sql_executed: string | null;
  sql_fingerprint: string | null;
  rls_context: Record<string, string> | null;
  status: 'success' | 'refused' | 'error' | 'canceled';
  error_code: ErrorCode | null;
  error_message: string | null;
  warnings: string[];
  rows_returned: number | null;
  rows_affected: number | null;
  duration_ms: number;
  budget_max_rows: number;
  budget_max_query_ms: number;
  payload_bytes: number | null;
  prev_hash: string;
  entry_hash: string;
  dropped_since_last: number;
  unsafe_role_override: boolean;
  pgmoat_version: string;
  server_name: string;
}

// ---------- doctor ----------
export interface DoctorFinding {
  code: `PGM-7${string}`;
  severity: 'fail' | 'warn' | 'info';
  subject: string;                       // e.g. 'role pgmoat_reader' or 'public.users.password_hash'
  message: string;
  fix: string;                           // SQL or config suggestion
}
```

### 2.1 Errors (`packages/core/src/errors.ts`)

```ts
export class PgmoatError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly kind: 'refused' | 'error' | 'canceled' = 'refused',
    public readonly hint?: string,
    public readonly httpStatus?: number,
  ) { super(message); this.name = 'PgmoatError'; }
  get docsUrl(): string { return `https://pgmoat.dev/docs/errors/${this.code}`; }
}

export const ERROR_CODES = { /* generated from section 4: code -> { title, kind, httpStatus? } */ } as const;
export type ErrorCode = keyof typeof ERROR_CODES;
```

---

## 3) Config schema (`pgmoat.yaml`)

### 3.1 Zod definition (`packages/core/src/config/schema.ts`)

```ts
import * as z from 'zod';

const ms = (min: number) => z.number().int().min(min);
const RlsSource = z.string().regex(/^(token\.[A-Za-z0-9_.-]+|env\.[A-Z_][A-Z0-9_]*|static:.+|meta\.[A-Za-z0-9_-]+)$/,
  'RLS source must be token.<claim>, env.<VAR>, static:<value>, or meta.<key>');
const PgSetting = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_.]*$/,
  'custom setting names need a prefix and a dot, e.g. app.tenant_id');

export const ColumnAnnotation = z.object({
  description: z.string().max(500).optional(),
  sensitive: z.enum(['low', 'medium', 'high']).optional(),
  hidden: z.boolean().default(false),
  untrusted: z.boolean().default(false),
}).strict();

export const TableAnnotation = z.object({
  description: z.string().max(500).optional(),
  hidden: z.boolean().default(false),
  sensitive_columns: z.array(z.string()).default([]),
  columns: z.record(z.string(), ColumnAnnotation).default({}),
  relationships: z.array(z.string().max(200)).default([]),
  // v1.1 scoped-write
  write: z.array(z.enum(['insert', 'update', 'delete'])).default([]),
  update_columns: z.array(z.string()).default([]),
  insert_required_columns: z.array(z.string()).default([]),
  insert_defaults: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  max_affected_rows: z.number().int().min(1).max(10_000).default(100),
}).strict();

const AuditCommon = {
  redact_fields: z.array(z.string()).default(['password', 'passwd', 'secret', 'token', 'api_key', 'apikey',
    'ssn', 'fein', 'card_number', 'credit_card', 'cvv', 'iban']),
  redact_in_sql: z.boolean().default(true),
  redact_patterns: z.array(z.string()).default(['\\b\\d{3}-\\d{2}-\\d{4}\\b']),
  buffer_max_bytes: z.number().int().min(65_536).default(10_485_760),
  flush_interval_ms: ms(10).default(100),
};

export const AuditConfig = z.discriminatedUnion('destination', [
  z.object({ destination: z.literal('stderr'), ...AuditCommon }).strict(),
  z.object({ destination: z.literal('stdout'), ...AuditCommon }).strict(),
  z.object({
    destination: z.literal('file'), ...AuditCommon,
    path: z.string().optional(),                                  // default: per-OS state dir
    rotation: z.union([z.literal('daily'), z.string().regex(/^size:\d+(KB|MB|GB)$/)]).default('daily'),
    retain_days: z.number().int().min(1).default(90),
  }).strict(),
  z.object({
    destination: z.literal('postgres'), ...AuditCommon,
    postgres: z.object({
      url: z.string().min(1),
      schema: z.string().default('pgmoat'),
      table: z.string().default('audit'),
      pool_max: z.number().int().min(1).max(20).default(3),
      tenant_key: z.string().default('app.tenant_id'),
      create_schema: z.boolean().default(true),
    }).strict(),
  }).strict(),
]);

export const PgmoatConfig = z.object({
  version: z.literal(1),
  server: z.object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    description: z.string().max(280).default(''),
  }).strict(),

  transport: z.enum(['stdio', 'http']).default('stdio'),
  http: z.object({
    host: z.string().default('127.0.0.1'),
    port: z.number().int().min(1).max(65535).default(8787),
    path: z.string().startsWith('/').default('/mcp'),
    public_url: z.string().url().optional(),                      // canonical URL; required when auth is set
    allowed_hosts: z.array(z.string()).default([]),
    allowed_origins: z.array(z.string()).default([]),
    max_body_bytes: z.number().int().min(1024).default(1_048_576),
  }).strict().prefault({}),

  auth: z.object({
    mode: z.enum(['oauth', 'none']).default('oauth'),
    issuer: z.string().url().optional(),
    audience: z.string().optional(),
    jwks_url: z.string().url().optional(),
    algorithms: z.array(z.string()).default(['RS256', 'ES256', 'EdDSA']),
    required_scopes: z.array(z.string()).default(['pgmoat:read']),
    clock_tolerance_s: z.number().int().min(0).max(300).default(30),
  }).strict().optional(),

  connection: z.object({
    url: z.string().min(1),
    schemas: z.array(z.string()).min(1).default(['public']),
    application_name: z.string().default('pgmoat'),
    pool: z.object({
      min: z.number().int().min(0).default(1),
      max: z.number().int().min(1).max(100).default(10),
      acquire_timeout_ms: ms(100).default(3000),
    }).strict().prefault({}),
    ssl: z.enum(['disable', 'prefer', 'require', 'verify-full']).optional(),  // overrides URL sslmode if set
  }).strict(),

  mode: z.enum(['read-only', 'scoped-write']).default('read-only'),

  budgets: z.object({
    max_rows: z.number().int().min(1).max(10_000).default(200),
    max_query_ms: ms(100).default(5000),
    max_explain_ms: ms(50).default(500),
    lock_timeout_ms: ms(10).default(1000),
    max_columns: z.number().int().min(1).max(1000).default(50),
    max_payload_bytes: z.number().int().min(1024).max(16_777_216).default(65_536),
    max_cell_chars: z.number().int().min(20).default(500),
    max_sql_chars: z.number().int().min(100).default(65_536),
    offset_warning: z.number().int().min(0).default(10_000),
  }).strict().prefault({}),

  rls: z.object({
    required: z.boolean().default(false),
    trust_request_meta: z.boolean().default(false),
    protected_tables: z.array(z.string()).default([]),
    session_variables: z.record(PgSetting, RlsSource).default({}),
  }).strict().prefault({}),

  policy: z.object({
    allow_catalog_queries: z.boolean().default(false),
    allowed_functions: z.array(z.string()).default([]),          // schema-qualified names, e.g. 'public.business_days'
    strict_unqualified_columns: z.boolean().default(true),
  }).strict().prefault({}),

  schema: z.object({
    cache_ttl_s: z.number().int().min(5).default(60),
    annotate_strict: z.boolean().default(false),
  }).strict().prefault({}),

  tables: z.record(z.string(), TableAnnotation).default({}),

  write: z.object({                                                // v1.1
    confirm: z.enum(['always', 'never']).default('always'),
  }).strict().prefault({}),

  audit: AuditConfig.prefault({ destination: 'file' }),

  doctor: z.object({
    on_start: z.enum(['enforce', 'warn', 'off']).default('enforce'),
  }).strict().prefault({}),

  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    format: z.enum(['ndjson', 'pretty']).default('ndjson'),
  }).strict().prefault({}),

  telemetry: z.object({
    enabled: z.boolean().default(false),
    endpoint: z.string().url().default('https://telemetry.pgmoat.dev/v1/events'),
  }).strict().prefault({}),
}).strict();

export type PgmoatConfigT = z.infer<typeof PgmoatConfig>;
```

Table keys in `tables` may be qualified (`billing.invoices`) or unqualified (resolved against `connection.schemas` in order).

Zod 4 note: nested objects use `.prefault({})`, not `.default({})`. In Zod 4, `.default(value)` returns the value as-is without applying the inner field defaults, so `.default({})` would yield an empty object. `.prefault({})` parses the value, which fills every inner default. A unit test asserts that `PgmoatConfig.parse(minimalConfig)` produces the full default tree.

### 3.2 Cross-field rules (checked after Zod)

| Rule | Code |
|---|---|
| `mode: scoped-write` requires at least one table with non-empty `write` (v1.1; in v1.0 `scoped-write` itself is refused with "available in v1.1") | `PGM-102` |
| `update_columns` non-empty requires `update` in `write` | `PGM-103` |
| `rls.required: true` requires at least one `session_variables` entry | `PGM-105` |
| `pool.max < pool.min` | `PGM-106` |
| `audit.destination: stdout` with `transport: stdio` | `PGM-111` |
| Any `meta.*` RLS source unless `transport: stdio` and `rls.trust_request_meta: true` | `PGM-112` |
| Any `token.*` RLS source unless `transport: http` and `auth.mode: oauth` | `PGM-113` |
| `transport: http` with a non-loopback `http.host` and (`auth` absent or `auth.mode: none`) | `PGM-114` |
| `auth.mode: oauth` missing `issuer`, `audience`, `jwks_url`, or `http.public_url` | `PGM-116` |
| `auth.audience` not equal to `http.public_url` (warning unless `--strict`) | `PGM-117` |
| `schema.annotate_strict: true` and a visible table lacks a description (checked after introspection) | `PGM-115` |
| `rls.protected_tables` entry not found in schema (after introspection) | `PGM-118` |
| `tables.<t>.columns.<c>` refers to a column not in the database (after introspection) | warning only |

### 3.3 Zero-config defaults (`config/defaults.ts`)

`pgmoat <url>` (or `pgmoat start --url-env VAR`) with no config file builds:

```yaml
version: 1
server: { name: pgmoat, description: "" }
transport: stdio
connection: { url: <from argument or env>, schemas: [public] }
mode: read-only
budgets: {}            # all defaults
rls: {}                # none
policy: {}             # catalog queries refused
tables: {}             # all tables visible, unannotated
audit: { destination: file }   # per-OS state dir
doctor: { on_start: warn }
```

### 3.4 Interpolation

- `${NAME}`: environment variable; missing gives `PGM-108`.
- `${NAME:-default}`: environment variable with default.
- `${file:/abs/path}`: file contents with trailing newline trimmed (Docker and Kubernetes secrets).
- Interpolation applies to string values only, once at load. `--watch` re-reads the file but not the environment.

---

## 4) Error code registry

Docs URL for every code: `https://pgmoat.dev/docs/errors/PGM-xxx` (domain per OD-01).
"Kind" is how the tool result is classified: `refused` (policy said no), `error` (something failed), `warning` (returned alongside a successful result).

### 0xx: Protocol and tool calls

| Code | Kind | Cause | Fix |
|---|---|---|---|
| PGM-001 | error | Unknown tool name | Use a tool listed by `tools/list` |
| PGM-002 | error | Unsupported protocol version | Update the client or pgmoat |
| PGM-003 | error | Transport failure | Restart; check that nothing else writes to stdout |
| PGM-004 | refused | Invalid tool arguments | Match the tool's input schema |

### 1xx: Configuration (startup)

| Code | Cause | Fix |
|---|---|---|
| PGM-101 | Cannot connect to Postgres | Check URL, network, `pg_isready -h <host> -p <port>` |
| PGM-102 | Scoped-write misconfigured or not yet available | Add per-table `write` lists (v1.1) or use read-only |
| PGM-103 | `update_columns` without `update` in `write` | Add `update` or remove `update_columns` |
| PGM-105 | `rls.required` with no session variables | Add `session_variables` or set `required: false` |
| PGM-106 | Pool max below min | Set `pool.max >= pool.min` |
| PGM-107 | YAML syntax error | Fix at the reported line and column |
| PGM-108 | Environment variable missing for interpolation | Set it or use `${NAME:-default}` |
| PGM-109 | Config schema validation failed | See the field path in the message; docs/config |
| PGM-110 | Unsupported config `version` | Use `version: 1` |
| PGM-111 | `stdout` audit with stdio transport | Use `stderr`, `file`, or `postgres` |
| PGM-112 | `meta.*` RLS source not allowed in this setup | Use stdio with `rls.trust_request_meta: true`, or use `token.*` over HTTP |
| PGM-113 | `token.*` RLS source without HTTP OAuth | Set `transport: http` and configure `auth` |
| PGM-114 | Public HTTP bind without auth | Configure `auth` or bind to 127.0.0.1 |
| PGM-115 | `annotate_strict` and unannotated tables | Add descriptions or turn off `annotate_strict` |
| PGM-116 | OAuth config incomplete | Provide `issuer`, `audience`, `jwks_url`, `http.public_url` |
| PGM-117 | Token audience differs from public URL | Make `auth.audience` equal `http.public_url` |
| PGM-118 | Protected table not found | Fix the name or the schema list |

### 2xx: SQL safety and access policy

| Code | Kind | Cause | Fix shown to the agent |
|---|---|---|---|
| PGM-201 | refused | Statement type not allowed in read-only mode (includes unknown node types) | Use SELECT to read data |
| PGM-202 | refused | `SELECT INTO`, `FOR UPDATE`, or `FOR SHARE` | Remove the INTO or locking clause |
| PGM-203 | refused | Writing statement inside a CTE | Remove the writing CTE |
| PGM-204 | refused | More than one statement | Send one statement per call |
| PGM-205 | refused | Function not allowed | Use an allowed function; see docs/safety#functions |
| PGM-206 | refused | SQL could not be parsed, is empty, or is too long | Fix the syntax; Postgres 18 grammar |
| PGM-207 | refused | Relation not allowed: hidden, unknown, outside exposed schemas, or a system catalog | Use list_tables to see available tables |
| PGM-208 | refused | Column not allowed: hidden column, whole-row reference, or `*` on a table with hidden columns | Select these columns instead: <list> |
| PGM-209 | refused | `EXPLAIN ANALYZE` would execute the statement | Use the explain tool for plans |
| PGM-210 | refused | Internal safety invariant failed after rewrite | Report a bug; the query was not run |

### 21x: Scoped writes (v1.1)

| Code | Cause |
|---|---|
| PGM-211 | Operation not allowed on this table |
| PGM-212 | Column not in `update_columns` |
| PGM-213 | Table not in any write allow-list |
| PGM-214 | Empty or always-true WHERE on UPDATE or DELETE |
| PGM-215 | INSERT missing required columns |
| PGM-216 | Write targets a hidden column |
| PGM-217 | Affected rows would exceed `max_affected_rows` |
| PGM-218 | Human confirmation declined, timed out, or unsupported by the client |

### 3xx: Budgets

| Code | Kind | Cause | Fix shown to the agent |
|---|---|---|---|
| PGM-301 | warning | Result capped at `max_rows` | Add WHERE or LIMIT to narrow |
| PGM-302 | refused | Requested LIMIT exceeds `max_rows` | Use LIMIT <= max_rows |
| PGM-303 | error | Query exceeded `max_query_ms` or `lock_timeout_ms` and was canceled | Narrow the query or add filters on indexed columns |
| PGM-304 | warning | Columns truncated to `max_columns` (alphabetical) | Select specific columns |
| PGM-305 | refused | Result larger than `max_payload_bytes` | Select fewer columns or rows |
| PGM-306 | warning | OFFSET above `offset_warning` | Use keyset pagination |
| PGM-307 | warning | Cell values truncated to `max_cell_chars` | Select a substring or fewer columns |
| PGM-308 | error | EXPLAIN exceeded `max_explain_ms` | Simplify the query |

### 4xx: Row-level security context

| Code | Kind | Cause | Fix |
|---|---|---|---|
| PGM-401 | refused | Required RLS value missing | Provide the identity source (token claim, env, meta) |
| PGM-402 | startup | Invalid session variable name | Use `prefix.name` form |
| PGM-403 | refused | RLS value empty or not a scalar | Provide a non-empty string, number, or boolean |
| PGM-404 | refused | Request supplied RLS meta that this server does not trust | Remove it, or enable `trust_request_meta` in stdio |
| PGM-405 | refused | Token lacks the configured claim | Configure the IdP to include the claim |

### 5xx: Operational

| Code | Kind | Cause | Fix |
|---|---|---|---|
| PGM-501 | log | Audit destination unreachable; entries buffered | Check the destination |
| PGM-502 | log | Audit buffer full; entries dropped | Fix the destination or raise `buffer_max_bytes` |
| PGM-503 | error | Timed out waiting for a database connection | Raise `pool.max` or reduce concurrency |
| PGM-504 | error | Database connection lost | Retry; check database health |
| PGM-505 | canceled | Client canceled the request; query canceled | None |
| PGM-506 | error | Internal error | Report a bug with the request_id |

### 6xx: HTTP authentication

| Code | HTTP | Cause | Fix |
|---|---|---|---|
| PGM-601 | 401 | Missing, invalid, expired, or wrong-audience token | Obtain a token for this server's URL |
| PGM-602 | 403 | Token lacks required scope | Request `pgmoat:read` |
| PGM-603 | 403 | Host or Origin header not allowed | Add to `allowed_hosts` / `allowed_origins` |

### 7xx: Doctor findings

| Code | Severity | Finding | Suggested fix |
|---|---|---|---|
| PGM-701 | fail | Role is a superuser | Create a dedicated `NOSUPERUSER` role |
| PGM-702 | fail (if RLS configured) | Role has `BYPASSRLS` | `ALTER ROLE <r> NOBYPASSRLS` |
| PGM-703 | fail | Role owns a protected table without `FORCE ROW LEVEL SECURITY` | `ALTER TABLE <t> FORCE ROW LEVEL SECURITY` or change owner |
| PGM-704 | fail | Protected table has RLS disabled | `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY` and add policies |
| PGM-705 | warn (fail with `--strict`) | Role can SELECT a hidden column | `REVOKE SELECT (<c>) ON <t> FROM <r>` or grant column lists |
| PGM-706 | warn | Role has write privileges in read-only mode | `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ... FROM <r>` |
| PGM-707 | warn | Postgres version outside the supported range | Upgrade, or accept parser limitations |

---

## 5) Hosted edition control plane (v1.5 sketch, not in v1)

```sql
CREATE TABLE orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL DEFAULT 'trial',
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT UNIQUE NOT NULL,
  idp_subject TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE org_members (
  org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  public_url TEXT UNIQUE NOT NULL,
  region TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'provisioning',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE server_config_revisions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  config_ciphertext BYTEA NOT NULL,        -- AES-256-GCM
  wrapped_dek BYTEA NOT NULL,              -- KMS-wrapped data key
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tunnels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  last_heartbeat TIMESTAMPTZ
);

CREATE TABLE audit_index (
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL,
  request_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  tenant TEXT,
  principal TEXT,
  object_key TEXT NOT NULL,                 -- location of the NDJSON line in object storage
  PRIMARY KEY (server_id, ts, request_id)
);
```

---

## 6) Open issues

| ID | Question | Lean |
|---|---|---|
| BS-01 | Store `sql_fingerprint` by default? | Yes; it contains no literals |
| BS-02 | Store `error_message` or only `error_code`? | Both; messages are sanitized |
| BS-03 | Generalize the tenant expression index to multiple keys? | No; one configurable key; operators add others |
| BS-04 | Add a `chain_head` table so verification can detect truncation of the newest entries? | v1.1: `pgmoat.audit_heads (instance_id, seq, entry_hash, updated_at)` written every 100 entries |
