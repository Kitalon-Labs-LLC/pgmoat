import { type ErrorCode } from './errors.generated.js';

export type Mode = 'read-only' | 'scoped-write';
export type Transport = 'stdio' | 'http';
export type Sensitivity = 'low' | 'medium' | 'high';
export type RelationKind =
  | 'table'
  | 'partitioned_table'
  | 'view'
  | 'materialized_view'
  | 'foreign_table';

// ---------- schema snapshot ----------
export interface SchemaSnapshot {
  builtAt: Date;
  serverVersionNum: number; // e.g. 180004
  relations: RelationInfo[]; // visible only, sorted by schema then name
  byQualifiedName: ReadonlyMap<string, RelationInfo>; // 'public.users'
  hiddenCount: number; // hidden relations (count only)
  policyIndex: PolicyIndex; // private: includes hidden names, used only by safety/policy.ts
}

export interface RelationInfo {
  schema: string;
  name: string;
  qualifiedName: string;
  kind: RelationKind;
  description: string; // annotation, else pg comment, else 'Unannotated'
  rowEstimate: number; // pg_class.reltuples (may be -1 if never analyzed)
  columns: ColumnInfo[]; // visible only, ordinal order
  hiddenColumnCount: number;
  primaryKey: string[] | null;
  uniqueKeys: string[][];
  foreignKeys: ForeignKeyInfo[];
  referencedBy: { relation: string; columns: string[] }[];
  indexes: IndexInfo[];
  relationships: string[]; // annotation text
  rls: { enabled: boolean; forced: boolean };
  owner: string;
  write: WriteRules; // v1.1 scoped-write; empty in read-only
}

export interface ColumnInfo {
  name: string;
  type: string; // format_type output, e.g. 'timestamp with time zone'
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

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
  definition: string;
}

export interface PolicyIndex {
  hiddenRelations: ReadonlySet<string>; // qualified names
  hiddenColumns: ReadonlyMap<string, ReadonlySet<string>>; // qualified relation -> hidden column names
  knownRelations: ReadonlySet<string>; // all relations in exposed schemas, hidden included
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
  sub: string; // 'local' for stdio
  scopes: ReadonlySet<string>;
  claims: Readonly<Record<string, unknown>>;
}

export interface RequestContext {
  requestId: string; // ULID
  instanceId: string;
  startedAt: Date;
  transport: Transport;
  protocolVersion: string | null;
  client: { name: string | null; version: string | null }; // self-reported
  principal: Principal;
  traceId: string | null;
  tool: ToolName;
  params: Readonly<Record<string, unknown>>;
  meta: Readonly<Record<string, unknown>>; // non-reserved request _meta
  signal: AbortSignal;
  // filled as the request proceeds
  rls: ResolvedRls | null;
  sqlExecuted: string | null;
  sqlFingerprint: string | null;
  warnings: string[];
  rowsReturned: number | null;
  payloadBytes: number | null;
}

export type ToolName =
  | 'describe_table'
  | 'explain'
  | 'list_tables'
  | 'query'
  | 'sample_table'
  | 'insert'
  | 'update'
  | 'delete'; // last three: v1.1

export interface ResolvedRls {
  entries: [name: string, value: string][]; // in config order
  sources: Record<string, 'token' | 'env' | 'static' | 'meta'>;
}

// ---------- safety ----------
export type SafetyResult =
  | {
      allowed: true;
      sql: string;
      fingerprint: string;
      limitInjected: boolean;
      statementType: 'select' | 'explain' | 'show';
    }
  | {
      allowed: false;
      code: ErrorCode;
      message: string;
      hint?: string;
      node?: string;
    };

// ---------- execution ----------
export interface ExecResult {
  fields: { name: string; dataTypeId: number; typeName: string }[];
  rows: Record<string, unknown>[];
  durationMs: number;
  truncatedByRowCap: boolean;
}

// ---------- tool output (matches output/schemas.ts) ----------
export interface RowsResult {
  columns: {
    name: string;
    type: string;
    untrusted: boolean;
    masked?: boolean;
  }[];
  rows: Record<string, JsonValue>[];
  row_count: number;
  truncated: boolean;
  warnings: { code: ErrorCode; message: string }[];
  request_id: string;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

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
  subject: string; // e.g. 'role pgmoat_reader' or 'public.users.password_hash'
  message: string;
  fix: string; // SQL or config suggestion
}
