import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import {
  startPostgres,
  connectionUrl,
  stopPostgres,
} from './harness/postgres.js';
import { createPools, type Pools } from '../../src/postgres/pool.js';
import { executeRead } from '../../src/postgres/execute.js';
import { PostgresDestination } from '../../src/audit/destinations/postgres.js';
import { AuditPipeline, type AuditDestination } from '../../src/audit/pipeline.js';
import { Chain } from '../../src/audit/chain.js';
import { verifyAuditEntries } from '../../src/audit/verify.js';
import { buildEntry, type RequestOutcome, type EntryMeta } from '../../src/audit/entry.js';
import { ensureAuditTable } from '../../src/audit/ddl.js';
import type { AuditEntry, RequestContext } from '../../src/types.js';

class OutageControllableDestination implements AuditDestination {
  readonly name = 'outage-postgres';
  public isOutage = true;
  private readonly realDest: PostgresDestination;

  constructor(realDest: PostgresDestination) {
    this.realDest = realDest;
  }

  async write(entries: readonly AuditEntry[]): Promise<void> {
    if (this.isOutage) {
      throw new Error('Audit destination outage: connection refused (simulated)');
    }
    await this.realDest.write(entries);
  }

  async close(): Promise<void> {
    await this.realDest.close();
  }
}

describe('Audit Outage & Resilience Integration (P5.7)', () => {
  let adminClient: pg.Client;
  let pools: Pools;

  beforeAll(async () => {
    await startPostgres();
    adminClient = new pg.Client({ connectionString: connectionUrl('postgres') });
    await adminClient.connect();

    // Recreate pgmoat.audit table
    await adminClient.query('DROP TABLE IF EXISTS pgmoat.audit CASCADE;');
    await ensureAuditTable(adminClient, {
      schema: 'pgmoat',
      table: 'audit',
      tenantKey: 'app.tenant_id',
      createSchema: true,
    });
    await adminClient.query('GRANT USAGE ON SCHEMA pgmoat TO pgmoat_audit;');
    await adminClient.query('GRANT SELECT, INSERT ON pgmoat.audit TO pgmoat_audit;');
    await adminClient.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgmoat TO pgmoat_audit;');

    pools = createPools({
      connection: {
        url: connectionUrl('pgmoat_reader'),
        schemas: ['public'],
        application_name: 'test-outage-reader',
        pool: { min: 1, max: 10, acquire_timeout_ms: 3000 },
      },
    });
  }, 60000);

  afterAll(async () => {
    await pools?.end();
    await adminClient?.end();
    await stopPostgres();
  });

  it('500 executeRead queries succeed during audit destination outage, buffer drops with accounting, and recovers without tampering', async () => {
    const instanceId = 'inst-outage-500';
    const chain = new Chain(instanceId);

    const realPostgres = new PostgresDestination({
      url: connectionUrl('pgmoat_audit'),
      schema: 'pgmoat',
      table: 'audit',
      createSchema: false,
    });
    const outageDest = new OutageControllableDestination(realPostgres);

    // Buffer capped at 25 KB (~30 entries capacity), flush interval manual for control
    const pipeline = new AuditPipeline({
      chain,
      destinations: [outageDest],
      bufferMaxBytes: 25 * 1024,
      flushIntervalMs: 0,
    });

    const meta: EntryMeta = {
      budgetMaxRows: 200,
      budgetMaxQueryMs: 5000,
      durationMs: 5,
    };

    const budgets = {
      max_rows: 200,
      max_query_ms: 5000,
      lock_timeout_ms: 1000,
    };

    // Phase 1: Destination is down (outage). Run 500 real executeRead calls.
    for (let i = 0; i < 500; i++) {
      const ctx: RequestContext = {
        requestId: `01JAB3W8K2Q9ABCDEF${String(i).padStart(8, '0')}`,
        instanceId,
        startedAt: new Date(Date.now() + i),
        transport: 'stdio',
        protocolVersion: '2026-07-28',
        client: { name: 'claude-desktop', version: '1.2.3' },
        principal: { kind: 'local', sub: 'local', scopes: new Set(), claims: {} },
        traceId: 'trace-123',
        tool: 'query',
        params: { sql: 'SELECT 1 AS n' },
        meta: {},
        signal: new AbortController().signal,
        warnings: [],
        sqlExecuted: 'SELECT 1 AS n',
      };

      // Query database: must succeed even while audit is failing
      const res = await executeRead(pools, 'SELECT 1 AS n', null, budgets);
      expect(res.rows.length).toBe(1);

      const outcome: RequestOutcome = {
        status: 'success',
        rowsReturned: 1,
        rowsAffected: null,
      };

      // Emit to pipeline (never blocks request path)
      const rawEntry = buildEntry(ctx, outcome, meta);
      pipeline.emit(rawEntry);
    }

    // Flush during outage fails gracefully without throwing to the caller
    await expect(pipeline.flush()).resolves.not.toThrow();

    // Verify buffer was exhausted and drops were accounted for
    expect(pipeline.totalDropped).toBeGreaterThan(0);
    expect(pipeline.bufferedBytes).toBeGreaterThan(0);

    // Phase 2: Recovery. The destination comes back online.
    outageDest.isOutage = false;

    // Wait for retry backoff timer to elapse
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Flush backlog from outage phase to free buffer space
    await pipeline.flush();

    // Now that buffer space is freed, emit recovery entry which seals recorded drops
    const recCtx: RequestContext = {
      requestId: '01JAB3W8K2Q9ABCDEF99999999',
      instanceId,
      startedAt: new Date(),
      transport: 'stdio',
      protocolVersion: '2026-07-28',
      client: { name: 'claude-desktop', version: '1.2.3' },
      principal: { kind: 'local', sub: 'local', scopes: new Set(), claims: {} },
      traceId: 'trace-recovery',
      tool: 'query',
      params: { sql: 'SELECT 1 AS n' },
      meta: {},
      signal: new AbortController().signal,
      warnings: [],
      sqlExecuted: 'SELECT 1 AS n',
    };
    const recOutcome: RequestOutcome = {
      status: 'success',
      rowsReturned: 1,
      rowsAffected: null,
    };
    await executeRead(pools, 'SELECT 1 AS n', null, budgets);
    const accepted = pipeline.emit(buildEntry(recCtx, recOutcome, meta));
    expect(accepted).toBe(true);

    // Flush recovery entry and shutdown
    await pipeline.flush();
    await pipeline.shutdown();

    // Phase 3: Verify entries stored in Postgres
    const dbRes = await adminClient.query(
      `SELECT * FROM pgmoat.audit
       WHERE instance_id = $1
       ORDER BY instance_id ASC, seq ASC`,
      [instanceId],
    );

    expect(dbRes.rows.length).toBeGreaterThan(0);
    expect(dbRes.rows.length).toBeLessThan(500); // Some were dropped due to bounded buffer

    const entries: AuditEntry[] = dbRes.rows.map((r) => ({
      request_id: r.request_id,
      instance_id: r.instance_id,
      seq: Number(r.seq),
      ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
      transport: r.transport,
      protocol_version: r.protocol_version,
      client_name: r.client_name,
      client_version: r.client_version,
      principal: r.principal,
      trace_id: r.trace_id,
      tool: r.tool,
      params: typeof r.params === 'string' ? JSON.parse(r.params) : r.params,
      sql_executed: r.sql_executed,
      sql_fingerprint: r.sql_fingerprint,
      rls_context: typeof r.rls_context === 'string' ? JSON.parse(r.rls_context) : r.rls_context,
      status: r.status,
      error_code: r.error_code,
      error_message: r.error_message,
      warnings: r.warnings ?? [],
      rows_returned: r.rows_returned,
      rows_affected: r.rows_affected,
      duration_ms: r.duration_ms,
      budget_max_rows: r.budget_max_rows,
      budget_max_query_ms: r.budget_max_query_ms,
      payload_bytes: r.payload_bytes,
      prev_hash: r.prev_hash,
      entry_hash: r.entry_hash,
      dropped_since_last: r.dropped_since_last,
      unsafe_role_override: r.unsafe_role_override,
      pgmoat_version: r.pgmoat_version,
      server_name: r.server_name,
    }));

    const report = verifyAuditEntries(entries);
    expect(report.instances.length).toBe(1);
    expect(report.instances[0].status).toBe('intact');
    expect(report.instances[0].intact).toBe(true);
    expect(report.instances[0].droppedRecorded).toBeGreaterThan(0);
    expect(report.allIntact).toBe(true);
  });
});
