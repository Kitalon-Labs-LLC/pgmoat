# Backend Schema: pgbridge
Doc owner: Sowad Al-Mughni
Status: Draft
Last updated: 2026-05-12
Companion docs: PRD (01), Feature Spec (02), Technical Architecture (03), TRD (04)

pgbridge is a Postgres tool, so "backend schema" here covers four distinct surfaces:

1. **Audit destination DDL**: the `pgbridge_audit` table emitted when `audit.destination: postgres` is set. This is the only DDL pgbridge writes to a user's database, and it must be stable across minor versions.
2. **In-memory runtime types**: the data structures the server holds during operation (schema snapshot, request context, audit entry, RLS context).
3. **Config schema**: the Zod definition of `pgbridge.yaml`, which is the developer-facing contract.
4. **Error code taxonomy**: the canonical list of PGB-XXX codes with cause and remediation.

A v1.5 cloud control plane schema sketch closes the doc, separated clearly because it is not part of the OSS surface.

---

## 1) Audit destination: `pgbridge_audit` table

### DDL (v1)

This DDL ships in `packages/core/src/audit/destinations/postgres.ts` and is applied via idempotent CREATE-IF-NOT-EXISTS on pgbridge startup when `audit.destination: postgres`. The schema is stable per SemVer: additive column changes allowed in minor versions, renames/drops only in majors.

```sql
-- pgbridge audit schema v1 (do not rename columns; additive changes only)
CREATE SCHEMA IF NOT EXISTS pgbridge;

CREATE TABLE IF NOT EXISTS pgbridge.audit (
    -- Identity
    id              BIGSERIAL PRIMARY KEY,
    request_id      TEXT NOT NULL,                 -- ULID; one per tool call
    session_id      TEXT NOT NULL,                 -- ULID; one per MCP session
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Client identity
    client_name     TEXT NOT NULL,                 -- e.g. "claude-desktop"
    client_version  TEXT,                          -- semver or build hash

    -- Tool call
    tool            TEXT NOT NULL,                 -- "query" | "describe_table" | ...
    params          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- post-redaction
    sql_executed    TEXT,                          -- post-redaction; nullable for non-SQL tools
    sql_ast_hash    TEXT,                          -- xxh3 hash of canonicalized AST for pattern analysis

    -- RLS / tenant context
    rls_context     JSONB,                         -- {tenant_id, user_id, ...}

    -- Result
    status          TEXT NOT NULL CHECK (status IN ('success', 'error', 'refused')),
    error_code      TEXT,                          -- PGB-XXX; null on success
    error_message   TEXT,                          -- sanitized; null on success
    rows_returned   INTEGER,                       -- for read tools
    rows_affected   INTEGER,                       -- for write tools
    duration_ms     INTEGER NOT NULL,
    warnings        TEXT[] DEFAULT '{}',           -- ['PGB-301', 'PGB-303']

    -- Budgets
    budget_rows_used     INTEGER,
    budget_rows_limit    INTEGER,
    budget_ms_used       INTEGER,
    budget_ms_limit      INTEGER,
    budget_columns_used  INTEGER,

    -- pgbridge metadata
    pgbridge_version  TEXT NOT NULL,
    server_name       TEXT NOT NULL                -- from server.name in config
);

-- Indexes for the three dominant query patterns:
-- (a) "show me everything tenant X did last week"
-- (b) "show me every refusal in the last hour"
-- (c) "rate of errors over time"
CREATE INDEX IF NOT EXISTS audit_created_at_idx ON pgbridge.audit (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_tenant_idx ON pgbridge.audit ((rls_context->>'tenant_id'), created_at DESC);
CREATE INDEX IF NOT EXISTS audit_status_idx ON pgbridge.audit (status, created_at DESC) WHERE status != 'success';
CREATE INDEX IF NOT EXISTS audit_session_idx ON pgbridge.audit (session_id);
CREATE INDEX IF NOT EXISTS audit_error_code_idx ON pgbridge.audit (error_code) WHERE error_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_tool_idx ON pgbridge.audit (tool, created_at DESC);

-- Optional partition by month for retention-driven workloads.
-- Off by default; enable via audit.postgres.partition_by_month: true in config.
-- (If enabled, pgbridge converts pgbridge.audit to a partitioned table and creates monthly partitions ahead-of-time.)

-- Optional retention policy via pg_cron (off by default; operator opt-in).
-- See docs/audit/retention for cron snippet.

COMMENT ON TABLE pgbridge.audit IS 'pgbridge audit log. One row per MCP tool call. Schema versioned; additive changes only in minor releases.';
COMMENT ON COLUMN pgbridge.audit.request_id IS 'ULID; uniquely identifies one tool call.';
COMMENT ON COLUMN pgbridge.audit.session_id IS 'ULID; persists across queries from one MCP session.';
COMMENT ON COLUMN pgbridge.audit.sql_ast_hash IS 'xxh3 of canonicalized AST; identical for SELECT 1 vs select  1; useful for pattern analysis without storing raw SQL.';
COMMENT ON COLUMN pgbridge.audit.params IS 'Tool params after redact_fields applied.';
COMMENT ON COLUMN pgbridge.audit.sql_executed IS 'Final SQL after AST mutations (auto-LIMIT), after redact_in_sql.';
```

### Why these indexes

| Index | Workload it supports |
|---|---|
| `audit_created_at_idx` | "What happened recently" timeline queries (the default dashboard view) |
| `audit_tenant_idx` | "Show everything tenant_id X did" investigations and per-tenant compliance exports |
| `audit_status_idx` (partial) | Refusal/error monitoring; partial index keeps it tiny since most rows are success |
| `audit_session_idx` | "Walk a single agent session" debugging |
| `audit_error_code_idx` (partial) | "Spike of PGB-302 timeouts" alerts |
| `audit_tool_idx` | "Which tool is the agent calling most" usage analysis |

### What is intentionally NOT stored

- Full result row content. Audit logs prove what happened, not what data flowed. Storing rows would create a parallel data store with its own retention nightmare.
- Cleartext sensitive values. Redaction runs before insert; if redact_fields is misconfigured the value still hits the audit, so operators must verify redact_fields covers their PII.
- The agent's natural-language prompt that led to this SQL. The MCP protocol does not expose this to the server, by design.

### Connection separation

The Postgres audit destination MUST use a separate pool from the query-execution pool. Reasons:

1. Audit can deadlock if it shares a pool and a query holds all connections.
2. Audit credentials should be `INSERT`-only; query credentials need `SELECT` on user tables. Separate roles.
3. Audit destination can live in a separate database entirely (`audit.postgres.url` distinct from `connection.url`).

```yaml
audit:
  destination: postgres
  postgres:
    url: ${AUDIT_DB_URL}        # may equal main DB or be separate
    schema: pgbridge            # default
    table: audit                # default
    pool_max: 5                 # smaller pool; audit is async batched
    partition_by_month: false   # default off
```

### Migrations and version stability

| Version | DDL change |
|---|---|
| v1.0 | Initial DDL above |
| v1.1+ | Additive columns only (e.g., add `agent_user_id` if MCP adds it); always nullable |
| v2.0 | Allowed to rename/drop; migration script ships and is documented |

pgbridge ships a `pgbridge audit migrate` command that prints the DDL diff vs the running version and asks for confirmation before applying.

---

## 2) In-memory runtime types

These are TypeScript types in `packages/core/src/types.ts`. They are the contract between subsystems (parser, executor, audit, tools).

### SchemaSnapshot

Built on startup from `information_schema` + `pg_catalog`, joined with `pgbridge.yaml`. Cached with 60s TTL.

```ts
export interface SchemaSnapshot {
  introspectedAt: Date;
  version: string;        // pgbridge version that built this
  schemas: SchemaInfo[];
  tablesByQualifiedName: Map<string, TableInfo>;     // "public.users" -> TableInfo
}

export interface SchemaInfo {
  name: string;            // "public"
  tables: TableInfo[];
  views: ViewInfo[];
}

export interface TableInfo {
  schema: string;
  name: string;
  qualifiedName: string;   // "public.users"
  description: string;     // from yaml or pg_class comment or "Unannotated"
  hidden: boolean;         // never expose to agent
  rowEstimate: number;     // from pg_class.reltuples
  columns: ColumnInfo[];
  primaryKey: string[] | null;
  foreignKeys: ForeignKeyInfo[];
  indexes: IndexInfo[];
  relationships: string[]; // human-readable, from yaml
  // Write controls (scoped-write mode only)
  write: WriteOp[];                    // ['insert', 'update', 'delete'] subset
  updateColumns: string[];             // column allow-list for UPDATE
  insertRequiredColumns: string[];
  insertDefaultColumns: Record<string, JsonValue>;
  maxAffectedRows: number;
}

export type WriteOp = 'insert' | 'update' | 'delete';

export interface ColumnInfo {
  name: string;
  dataType: string;        // 'text', 'uuid', 'jsonb', ...
  notNull: boolean;
  default: string | null;
  ordinalPosition: number;
  description: string;
  sensitive: 'low' | 'medium' | 'high' | null;
  hidden: boolean;
}

export interface ForeignKeyInfo {
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete: 'NO ACTION' | 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'SET DEFAULT';
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
}

export interface ViewInfo {
  schema: string;
  name: string;
  qualifiedName: string;
  description: string;
  hidden: boolean;
  materialized: boolean;
  columns: Pick<ColumnInfo, 'name' | 'dataType' | 'description'>[];
}
```

### RequestContext

Built per tool call. Lives for the duration of one MCP `tools/call` invocation.

```ts
export interface RequestContext {
  requestId: string;       // ULID
  sessionId: string;       // ULID, persists per MCP session
  startedAt: Date;
  client: {
    name: string;          // from MCP initialize handshake
    version: string;
  };
  tool: string;            // 'query', 'describe_table', ...
  params: Record<string, unknown>;   // raw input; redacted before audit
  rlsContext: RlsContext | null;
  // Mutable as the request proceeds
  sqlExecuted: string | null;        // populated by tools/query after AST rewrite
  warnings: string[];                // PGB-XXX codes appended as budgets fire
  budgetUsage: BudgetUsage;
}

export interface RlsContext {
  variables: Record<string, string>;  // 'app.current_tenant_id' -> 'tnt_abc'
  source: 'request_meta' | 'config_default';
}

export interface BudgetUsage {
  rowsUsed: number | null;
  rowsLimit: number;
  msUsed: number | null;
  msLimit: number;
  columnsUsed: number | null;
  columnsLimit: number;
  payloadBytesUsed: number | null;
  payloadBytesLimit: number;
}
```

### AuditEntry

Built by the audit pipeline at the end of every request, post-redaction. Maps 1:1 to the `pgbridge.audit` table columns above.

```ts
export interface AuditEntry {
  timestamp: string;             // ISO 8601 UTC ms
  requestId: string;
  sessionId: string;
  client: { name: string; version: string | null };
  tool: string;
  params: Record<string, unknown>;       // post-redaction
  sqlExecuted: string | null;            // post-redaction
  sqlAstHash: string | null;             // xxh3
  rlsContext: Record<string, string> | null;
  status: 'success' | 'error' | 'refused';
  errorCode: string | null;              // PGB-XXX
  errorMessage: string | null;           // sanitized
  rowsReturned: number | null;
  rowsAffected: number | null;
  durationMs: number;
  warnings: string[];
  budget: {
    rows: { used: number | null; limit: number };
    ms: { used: number | null; limit: number };
    columns: { used: number | null };
  };
  pgbridgeVersion: string;
  serverName: string;
}
```

### ClassifyResult (SQL safety output)

```ts
export type ClassifyResult =
  | { allowed: true; ast: ParseTree[]; autoLimit: { injected: boolean; limit: number } }
  | { allowed: false; code: ErrorCode; message: string; offendingNode?: string };
```

### Error type

```ts
export class PgbridgeError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusKind: 'refused' | 'error' = 'refused',
  ) {
    super(message);
    this.name = 'PgbridgeError';
  }
}

export type ErrorCode =
  | `PGB-${string}`;   // narrowed in errors.ts to literal union of valid codes
```

---

## 3) Config schema (Zod definition)

Lives in `packages/core/src/config/schema.ts`. This is the single source of truth for `pgbridge.yaml` validation; the docs site reference is generated from it.

```ts
import { z } from 'zod';

export const PoolConfig = z.object({
  min: z.number().int().min(0).default(2),
  max: z.number().int().min(1).default(20),
  queue_timeout_ms: z.number().int().min(0).default(3000),
}).strict();

export const ConnectionConfig = z.object({
  url: z.string().min(1),
  schema: z.array(z.string()).default(['public']),
  pool: PoolConfig.default({}),
  statement_timeout_ms: z.number().int().min(100).default(5000),
  application_name: z.string().default('pgbridge'),
}).strict();

export const BudgetsConfig = z.object({
  max_rows: z.number().int().min(1).default(1000),
  max_query_ms: z.number().int().min(100).default(5000),
  max_columns: z.number().int().min(1).default(50),
  max_payload_bytes: z.number().int().min(1024).default(1_048_576),
  max_explain_ms: z.number().int().min(50).default(500),
}).strict();

export const RlsConfig = z.object({
  required: z.boolean().default(false),
  session_variables: z.record(
    z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_.]*$/, 'invalid pg setting name'),
    z.string().startsWith('from_request.'),
  ).default({}),
}).strict();

export const SensitivityLevel = z.enum(['low', 'medium', 'high']);

export const ColumnAnnotation = z.object({
  description: z.string().optional(),
  sensitive: SensitivityLevel.optional(),
  hidden: z.boolean().default(false),
}).strict();

export const TableAnnotation = z.object({
  description: z.string().optional(),
  hidden: z.boolean().default(false),
  sensitive_columns: z.array(z.string()).default([]),
  columns: z.record(z.string(), ColumnAnnotation).default({}),
  relationships: z.array(z.string()).default([]),
  // Scoped-write only:
  write: z.array(z.enum(['insert', 'update', 'delete'])).default([]),
  update_columns: z.array(z.string()).default([]),
  insert_required_columns: z.array(z.string()).default([]),
  insert_default_columns: z.record(z.string(), z.unknown()).default({}),
  max_affected_rows: z.number().int().min(1).default(100),
}).strict();

export const AuditDestinationFile = z.object({
  destination: z.literal('file'),
  path: z.string().default('/var/log/pgbridge/audit.log'),
  rotation: z.union([z.literal('daily'), z.string().regex(/^size:\d+(KB|MB|GB)$/i)]).default('daily'),
  retain_days: z.number().int().min(1).default(90),
});

export const AuditDestinationPostgres = z.object({
  destination: z.literal('postgres'),
  postgres: z.object({
    url: z.string().min(1),
    schema: z.string().default('pgbridge'),
    table: z.string().default('audit'),
    pool_max: z.number().int().min(1).default(5),
    partition_by_month: z.boolean().default(false),
  }),
});

export const AuditDestinationStdout = z.object({ destination: z.literal('stdout') });
export const AuditDestinationDatadog = z.object({
  destination: z.literal('datadog'),
  datadog: z.object({ api_key: z.string(), site: z.string().default('datadoghq.com') }),
});
export const AuditDestinationS3 = z.object({
  destination: z.literal('s3'),
  s3: z.object({ bucket: z.string(), prefix: z.string().default('pgbridge/audit/') }),
});

export const AuditConfig = z.discriminatedUnion('destination', [
  AuditDestinationStdout,
  AuditDestinationFile,
  AuditDestinationPostgres,
  AuditDestinationDatadog,
  AuditDestinationS3,
]).and(z.object({
  redact_fields: z.array(z.string()).default(['password', 'password_hash', 'fein', 'ssn', 'api_key', 'token', 'credit_card', 'card_number']),
  redact_in_sql: z.boolean().default(true),
  redact_patterns: z.array(z.string()).default([]),
  buffer_max_bytes: z.number().int().min(1024).default(10_485_760),
}));

export const PgbridgeConfig = z.object({
  version: z.literal(1),
  server: z.object({
    name: z.string().regex(/^[a-z0-9-]+$/).max(64),
    description: z.string().max(280),
  }),
  connection: ConnectionConfig,
  mode: z.enum(['read-only', 'scoped-write']).default('read-only'),
  budgets: BudgetsConfig.default({}),
  rls: RlsConfig.default({}),
  tables: z.record(z.string(), TableAnnotation).default({}),
  annotate_strict: z.boolean().default(false),
  audit: AuditConfig,
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    format: z.enum(['ndjson', 'text']).default('ndjson'),
  }).default({}),
  telemetry: z.object({
    enabled: z.boolean().default(false),
    endpoint: z.string().url().default('https://telemetry.pgbridge.dev/v1/events'),
  }).default({}),
  extensions: z.object({
    allowed_functions: z.array(z.string()).default([]),
  }).default({}),
}).strict()
  // Cross-field invariants:
  .refine(c => c.mode === 'read-only' || Object.values(c.tables).some(t => t.write.length > 0), {
    message: 'mode: scoped-write requires at least one table with write operations',
    path: ['tables'],
  })
  .refine(c => Object.values(c.tables).every(t => t.update_columns.length === 0 || t.write.includes('update')), {
    message: 'update_columns is only valid when write includes "update"',
    path: ['tables'],
  });

export type PgbridgeConfigT = z.infer<typeof PgbridgeConfig>;
```

### Cross-field invariants enforced at load time

| Rule | Error code |
|---|---|
| `mode: scoped-write` requires ≥1 table with `write: [...]` non-empty | `PGB-102` |
| `update_columns` requires `write` to include `update` | `PGB-103` |
| `audit.destination: postgres` requires `audit.postgres.url` | `PGB-104` |
| `rls.required: true` requires at least one entry in `rls.session_variables` | `PGB-105` |
| `connection.pool.max < connection.pool.min` | `PGB-106` |

---

## 4) Error code taxonomy

Single source of truth for every PGB-XXX code. Sorted by domain prefix. Each gets a doc page at `pgbridge.dev/docs/error-codes#PGB-XXX`.

### 0XX: System / startup

| Code | Cause | Remediation |
|---|---|---|
| PGB-001 | Unknown tool name in tools/call | Check tool name matches one registered by pgbridge |
| PGB-002 | MCP protocol handshake failed | Verify MCP SDK version compatibility |
| PGB-003 | Stdio transport error | Restart pgbridge; check stdin/stdout not being intercepted |

### 1XX: Configuration

| Code | Cause | Remediation |
|---|---|---|
| PGB-101 | Postgres connection refused | Verify URL and `pg_isready -h <host>` |
| PGB-102 | scoped-write mode with no write allow-list | Either switch mode or add `tables.X.write: [...]` |
| PGB-103 | update_columns without update in write list | Add `update` to write list or drop update_columns |
| PGB-104 | audit.destination: postgres without postgres.url | Provide audit.postgres.url |
| PGB-105 | rls.required: true with no session_variables | Add session_variables or set required: false |
| PGB-106 | pool max < pool min | Adjust pool.max >= pool.min |
| PGB-107 | Invalid YAML syntax | Check the line/column reported; YAML lint |
| PGB-108 | Required env var unset for ${VAR} interpolation | Set the env var or change the config field |
| PGB-109 | Config schema validation failure | Read message; see docs/config |
| PGB-110 | Schema version mismatch | Migrate config; see docs/migrations |

### 2XX: SQL safety (read-only)

| Code | Cause | Remediation |
|---|---|---|
| PGB-201 | Non-SELECT statement in read-only mode | Switch to scoped-write or rewrite as SELECT |
| PGB-202 | SELECT INTO / FOR UPDATE / FOR SHARE in read-only | Use plain SELECT |
| PGB-203 | Writing CTE detected | Remove the writing CTE |
| PGB-204 | Multiple statements in one query | Split into separate calls |
| PGB-205 | Forbidden function call | Function on deny list; see docs/safety |
| PGB-206 | Unrecognized SQL (parser error) | Check SQL syntax |

### 2XX: SQL safety (scoped-write)

| Code | Cause | Remediation |
|---|---|---|
| PGB-211 | Write operation on table not in allow-list | Add table to write list or use a different table |
| PGB-212 | UPDATE column not in update_columns | Add column to update_columns |
| PGB-213 | Table not in any write allow-list | Configure the table for writes |
| PGB-214 | Empty/always-true WHERE on UPDATE/DELETE | Add a meaningful WHERE clause |
| PGB-215 | INSERT missing insert_required_columns | Provide required values |
| PGB-216 | INSERT attempting to set hidden column | Remove the column from input |
| PGB-217 | Bulk write exceeds max_affected_rows | Split into smaller batches |

### 3XX: Budgets

| Code | Cause | Remediation |
|---|---|---|
| PGB-301 | Auto-limited to max_rows (warning) | Add LIMIT or WHERE for explicit narrowing |
| PGB-301a | Explicit LIMIT exceeds max_rows budget | Lower the LIMIT or raise the budget |
| PGB-302 | Query exceeded max_query_ms; canceled | Optimize query or raise budget for this server |
| PGB-303 | Result truncated to max_columns (warning) | Specify columns explicitly |
| PGB-304 | Result exceeds max_payload_bytes | Narrow with WHERE or LIMIT |
| PGB-305 | OFFSET > 10000 (warning) | Use keyset pagination |

### 4XX: RLS

| Code | Cause | Remediation |
|---|---|---|
| PGB-401 | RLS context required but missing keys | Provide _meta.rls_context with required keys |
| PGB-402 | RLS variable name invalid (regex) | Fix the variable name in pgbridge.yaml |
| PGB-403 | RLS variable value rejected | Provide a value (empty treated as missing) |

### 5XX: Audit and operational

| Code | Cause | Remediation |
|---|---|---|
| PGB-501 | Audit destination unreachable; entry queued | Verify destination; check stderr for CRITICAL alarm |
| PGB-502 | Audit queue full; entry dropped | Increase buffer_max_bytes or speed up destination |
| PGB-503 | Pool connection acquire timeout | Raise pool.max or pool.queue_timeout_ms |
| PGB-504 | Postgres connection lost during query | Transient; retry; check DB availability |

---

## 5) v1.5 cloud control plane schema (sketch)

Out of scope for v1 OSS but documented for forward planning. Not part of the public pgbridge contract; lives in `pgbridge-cloud/` as a separate repo.

### Tables (Neon Postgres)

```sql
-- Organizations
CREATE TABLE orgs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT UNIQUE NOT NULL,
    plan            TEXT NOT NULL DEFAULT 'free',    -- free | starter | growth | enterprise
    stripe_customer_id TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Users (auth via WorkOS or Clerk)
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           CITEXT UNIQUE NOT NULL,
    auth_provider_id TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE org_members (
    org_id          UUID REFERENCES orgs(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
    PRIMARY KEY (org_id, user_id)
);

-- Hosted pgbridge servers
CREATE TABLE servers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    subdomain       TEXT UNIQUE NOT NULL,            -- {subdomain}.pgbridge.dev
    region          TEXT NOT NULL DEFAULT 'iad',     -- Fly.io region
    runtime_version TEXT NOT NULL,                   -- which pgbridge OSS version
    status          TEXT NOT NULL DEFAULT 'provisioning',  -- provisioning | running | stopped | error
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, name)
);

-- Encrypted config snapshot (envelope-encrypted)
CREATE TABLE server_configs (
    server_id       UUID PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    config_yaml_enc BYTEA NOT NULL,            -- AES-GCM
    config_dek_enc  BYTEA NOT NULL,            -- KEK from KMS wraps DEK
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      UUID REFERENCES users(id)
);

-- Audit log shadow (indexed for search; raw NDJSON in S3)
CREATE TABLE audit_index (
    server_id       UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    request_id      TEXT NOT NULL,
    s3_key          TEXT NOT NULL,            -- s3://bucket/org_id/server_id/yyyy/mm/dd/req.ndjson
    timestamp       TIMESTAMPTZ NOT NULL,
    tool            TEXT NOT NULL,
    status          TEXT NOT NULL,
    tenant_id       TEXT,
    duration_ms     INTEGER,
    error_code      TEXT,
    PRIMARY KEY (server_id, timestamp DESC, request_id)
);

CREATE INDEX audit_index_server_status_idx ON audit_index (server_id, status, timestamp DESC) WHERE status != 'success';
CREATE INDEX audit_index_tenant_idx ON audit_index (server_id, tenant_id, timestamp DESC);

-- Tunnels (Tailscale-style outbound tunnel from customer infra)
CREATE TABLE tunnels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id       UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    auth_key_enc    BYTEA NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',  -- pending | connected | disconnected
    connected_at    TIMESTAMPTZ,
    last_heartbeat  TIMESTAMPTZ
);

-- Annotation suggestions (cloud-only feature; Claude-powered)
CREATE TABLE annotation_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id       UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'pending',
    suggestions_jsonb JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);

-- Billing
CREATE TABLE billing_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    stripe_event_id TEXT UNIQUE,
    type            TEXT NOT NULL,
    amount_cents    INTEGER,
    occurred_at     TIMESTAMPTZ NOT NULL
);
```

### Data flow summary

```
Customer infra:
  Postgres -- (tunnel) --> Fly.io machine running pgbridge OSS -- stdio --> MCP client

Control plane (Cloudflare Workers + Neon):
  - Stores org/user/server metadata
  - Encrypts and persists pgbridge.yaml
  - Receives audit shipments from runtime machines
  - Powers web UI for config editing and audit search

Audit storage:
  - Raw NDJSON: S3 per org/server/day
  - Index: audit_index table for search
```

### Why this structure works

| Property | Mechanism |
|---|---|
| Tenant isolation | One pgbridge process per server; one Fly.io machine per server |
| Config secrecy | Envelope encryption: config DEK wrapped with KMS KEK; control plane never holds plaintext at rest |
| Audit volume | Raw NDJSON in S3 (cheap); only fields needed for search live in Postgres index |
| Disaster recovery | Control plane DB backed up; runtime processes stateless; config restored from encrypted snapshot |
| Operator key rotation | KEK rotation via KMS without re-encrypting every config |

---

## 6) Open issues

| ID | Question | Owner | Due |
|---|---|---|---|
| BS-01 | Should we store `sql_ast_hash` for usage pattern analysis, accepting the small fingerprinting risk? Default: yes; documented. | Sowad | 2026-05-15 |
| BS-02 | Should `error_message` ever appear in the audit (post-sanitization), or only `error_code`? Argument for code-only: zero leak risk. Argument for both: better debuggability. Current default: both, with sanitizer. | Sowad | 2026-05-15 |
| BS-03 | v1.5 cloud: encrypt audit index PII fields (tenant_id) at the column level? Adds complexity; deferred unless enterprise customers require. | Sowad | v1.5 planning |
| BS-04 | Bigint vs UUID for the `id` PK on `pgbridge.audit`? Current choice: bigserial for cheap monotonic ordering. Revisit if multi-region writes added. | Sowad | v1.1 |
