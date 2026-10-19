/* eslint-disable pgmoat/no-sql-string-building */
// Documented lint exception: multi-row INSERT with generated parameter placeholders only
import pg from 'pg';
import type { AuditEntry } from '../../types.js';
import type { AuditDestination } from '../pipeline.js';
import {
  AUDIT_INSERT_COLUMNS,
  ensureAuditTable,
  validateIdentifier,
  validateSettingName,
} from '../ddl.js';

export interface PostgresDestinationOptions {
  url: string;
  schema?: string;
  table?: string;
  poolMax?: number;
  tenantKey?: string;
  createSchema?: boolean;
  pool?: pg.Pool; // injected pool for testing
}

export class PostgresDestination implements AuditDestination {
  readonly name = 'postgres';
  private readonly schema: string;
  private readonly table: string;
  private readonly tenantKey: string;
  private readonly createSchema: boolean;
  private readonly pool: pg.Pool;
  private readonly ownsPool: boolean;
  private initialized = false;

  constructor(options: PostgresDestinationOptions) {
    this.schema = validateIdentifier(options.schema ?? 'pgmoat', 'schema');
    this.table = validateIdentifier(options.table ?? 'audit', 'table');
    this.tenantKey = validateSettingName(options.tenantKey ?? 'app.tenant_id');
    this.createSchema = options.createSchema ?? true;

    if (options.pool) {
      this.pool = options.pool;
      this.ownsPool = false;
    } else {
      this.pool = new pg.Pool({
        connectionString: options.url,
        max: options.poolMax ?? 3,
        application_name: 'pgmoat-audit',
      });
      this.ownsPool = true;
    }
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await ensureAuditTable(this.pool, {
      schema: this.schema,
      table: this.table,
      tenantKey: this.tenantKey,
      createSchema: this.createSchema,
    });
    this.initialized = true;
  }

  async write(entries: readonly AuditEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    if (!this.initialized) {
      await this.init();
    }

    const columnsList = AUDIT_INSERT_COLUMNS.join(', ');
    const numCols = AUDIT_INSERT_COLUMNS.length;
    const maxRowsPerBatch = 500;

    for (let i = 0; i < entries.length; i += maxRowsPerBatch) {
      const batch = entries.slice(i, i + maxRowsPerBatch);
      const values: unknown[] = [];
      const rowPlaceholders: string[] = [];

      for (const [r, entry] of batch.entries()) {
        const offset = r * numCols;
        const placeholders: string[] = [];

        for (let c = 0; c < numCols; c++) {
          placeholders.push(`$${offset + c + 1}`);
        }
        rowPlaceholders.push(`(${placeholders.join(', ')})`);

        values.push(
          entry.request_id,
          entry.instance_id,
          entry.seq,
          entry.ts,
          entry.transport,
          entry.protocol_version ?? null,
          entry.client_name ?? null,
          entry.client_version ?? null,
          entry.principal,
          entry.trace_id ?? null,
          entry.tool,
          JSON.stringify(entry.params ?? {}),
          entry.sql_executed ?? null,
          entry.sql_fingerprint ?? null,
          entry.rls_context ? JSON.stringify(entry.rls_context) : null,
          entry.status,
          entry.error_code ?? null,
          entry.error_message ?? null,
          entry.warnings ?? [],
          entry.rows_returned ?? null,
          entry.rows_affected ?? null,
          entry.duration_ms,
          entry.budget_max_rows,
          entry.budget_max_query_ms,
          entry.payload_bytes ?? null,
          entry.prev_hash,
          entry.entry_hash,
          entry.dropped_since_last ?? 0,
          Boolean(entry.unsafe_role_override),
          entry.pgmoat_version,
          entry.server_name,
        );
      }

      const sql = `INSERT INTO ${this.schema}.${this.table} (${columnsList}) VALUES ${rowPlaceholders.join(', ')}`;
      await this.pool.query(sql, values);
    }
  }

  async close(): Promise<void> {
    if (this.ownsPool) {
      await this.pool.end();
    }
  }
}

