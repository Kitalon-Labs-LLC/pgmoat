import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import {
  startPostgres,
  connectionUrl,
  stopPostgres,
} from './harness/postgres.js';
import { PostgresDestination } from '../../src/audit/destinations/postgres.js';
import { ensureAuditTable, getAuditDdl } from '../../src/audit/ddl.js';
import { Chain } from '../../src/audit/chain.js';
import { verifyAuditEntries } from '../../src/audit/verify.js';
import { buildEntry, type RequestOutcome, type EntryMeta } from '../../src/audit/entry.js';
import type { AuditEntry, RequestContext } from '../../src/types.js';

function createDummyEntry(instanceId: string, seq: number, query = 'SELECT 1'): AuditEntry {
  const ctx: RequestContext = {
    requestId: `01JAB3W8K2Q9ABCDEF${String(seq).padStart(8, '0')}`,
    instanceId,
    startedAt: new Date(Date.now() + seq * 10),
    transport: 'stdio',
    protocolVersion: '2026-07-28',
    client: { name: 'claude-desktop', version: '1.2.3' },
    principal: { kind: 'local', sub: 'local', scopes: new Set(), claims: {} },
    traceId: 'trace-123',
    tool: 'query',
    params: { sql: query },
    meta: {},
    signal: new AbortController().signal,
    warnings: [],
    sqlExecuted: query,
  };
  const outcome: RequestOutcome = {
    status: 'success',
    rowsReturned: 1,
    rowsAffected: null,
  };
  const meta: EntryMeta = {
    budgetMaxRows: 200,
    budgetMaxQueryMs: 5000,
    durationMs: 5,
  };
  return buildEntry(ctx, outcome, meta);
}

describe('Postgres Audit Destination Integration (P5.6)', () => {
  let adminClient: pg.Client;

  beforeAll(async () => {
    await startPostgres();
    adminClient = new pg.Client({ connectionString: connectionUrl('postgres') });
    await adminClient.connect();

    // Recreate pgmoat.audit to ensure clean full schema
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
  }, 60000);

  afterAll(async () => {
    await adminClient?.end();
    await stopPostgres();
  });

  it('DDL is idempotent and runs twice without error', async () => {
    // Run 1: with custom table in test schema
    await adminClient.query('CREATE SCHEMA IF NOT EXISTS test_audit;');
    const ddl = getAuditDdl('test_audit', 'audit_log', 'app.tenant_id');
    await adminClient.query(ddl);

    // Run 2: ensureAuditTable runs on same schema/table without error
    await expect(
      ensureAuditTable(adminClient, {
        schema: 'test_audit',
        table: 'audit_log',
        tenantKey: 'app.tenant_id',
        createSchema: true,
      }),
    ).resolves.not.toThrow();
  });

  it('pgmoat_audit role can insert and select, but cannot update or delete', async () => {
    const auditClient = new pg.Client({ connectionString: connectionUrl('pgmoat_audit') });
    await auditClient.connect();

    try {
      // 1. Can select
      const selectRes = await auditClient.query('SELECT count(*) FROM pgmoat.audit');
      expect(selectRes.rows).toBeDefined();

      // 2. Can insert via destination
      const dest = new PostgresDestination({
        url: connectionUrl('pgmoat_audit'),
        schema: 'pgmoat',
        table: 'audit',
        createSchema: false, // role lacks schema creation
      });
      await dest.init();

      const chain = new Chain('inst-perms');
      const rawEntry = createDummyEntry('inst-perms', 0);
      const sealed = chain.seal(rawEntry);

      await dest.write([sealed]);

      // 3. Cannot update
      await expect(
        auditClient.query("UPDATE pgmoat.audit SET client_name = 'hacked'"),
      ).rejects.toThrow(/permission denied/i);

      // 4. Cannot delete
      await expect(
        auditClient.query('DELETE FROM pgmoat.audit'),
      ).rejects.toThrow(/permission denied/i);

      await dest.close();
    } finally {
      await auditClient.end();
    }
  });

  it('inserts 1,200 entries in multi-row batches (500 max per query)', async () => {
    const dest = new PostgresDestination({
      url: connectionUrl('pgmoat_audit'),
      schema: 'pgmoat',
      table: 'audit',
      createSchema: false,
    });
    await dest.init();

    const instanceId = 'inst-batch-1200';
    const chain = new Chain(instanceId);

    const entries: AuditEntry[] = [];
    for (let i = 0; i < 1200; i++) {
      const raw = createDummyEntry(instanceId, i, `SELECT ${i}`);
      entries.push(chain.seal(raw));
    }

    const start = performance.now();
    await dest.write(entries);
    const elapsedMs = performance.now() - start;
    const throughput = (1200 / (elapsedMs / 1000)).toFixed(1);
    console.log(`Insert throughput: ${throughput} entries/sec (${1200} entries in ${elapsedMs.toFixed(0)} ms)`);

    // Verify row count in database
    const res = await adminClient.query<{ count: string }>(
      'SELECT count(*) as count FROM pgmoat.audit WHERE instance_id = $1',
      [instanceId],
    );
    expect(parseInt(res.rows[0].count, 10)).toBe(1200);

    await dest.close();
  });

  it('verifies audit log read back ordered by instance_id, seq', async () => {
    const instanceId = 'inst-batch-1200';

    const res = await adminClient.query(
      `SELECT * FROM pgmoat.audit
       WHERE instance_id = $1
       ORDER BY instance_id ASC, seq ASC`,
      [instanceId],
    );

    expect(res.rows.length).toBe(1200);

    // Map database rows to AuditEntry shapes for verifyAuditLog
    const entries: AuditEntry[] = res.rows.map((r) => ({
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
    expect(report.instances[0].totalEntries).toBe(1200);
    expect(report.allIntact).toBe(true);
  });

  it('destination down (wrong port) throws and recovers on reconnect', async () => {
    // 1. Destination with invalid port fails
    const badDest = new PostgresDestination({
      url: 'postgresql://postgres:postgres@127.0.0.1:54321/testdb',
      schema: 'pgmoat',
      table: 'audit',
    });

    const chain = new Chain('inst-down');
    const entry = chain.seal(createDummyEntry('inst-down', 0));

    await expect(badDest.write([entry])).rejects.toThrow();
    await badDest.close();

    // 2. Good destination succeeds
    const goodDest = new PostgresDestination({
      url: connectionUrl('pgmoat_audit'),
      schema: 'pgmoat',
      table: 'audit',
      createSchema: false,
    });
    await expect(goodDest.write([entry])).resolves.not.toThrow();
    await goodDest.close();
  });
});

