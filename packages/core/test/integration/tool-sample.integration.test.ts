import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import {
  startPostgres,
  connectionUrl,
} from './harness/postgres.js';
import { introspect } from '../../src/postgres/introspect.js';
import { buildSnapshot } from '../../src/schema/snapshot.js';
import { PgmoatConfig } from '../../src/config/schema.js';
import { createPools, type Pools } from '../../src/postgres/pool.js';
import { sampleTableTool } from '../../src/tools/sample-table.js';
import type { ToolDeps } from '../../src/tools/context.js';
import type { AuditEntry, SchemaSnapshot } from '../../src/types.js';
import type { SchemaCache } from '../../src/schema/cache.js';
import type { RowsResult } from '../../src/types.js';

interface ResultWithStructured {
  structuredContent?: RowsResult;
}

describe('sample_table tool integration (P6.7)', () => {
  let adminClient: pg.Client;
  let pools: Pools;
  let emittedAudit: AuditEntry[] = [];
  let deps: ToolDeps;
  let snapshot: SchemaSnapshot;

  beforeAll(async () => {
    await startPostgres();
    const url = connectionUrl('pgmoat_reader');
    const adminUrl = connectionUrl('postgres');

    adminClient = new pg.Client({ connectionString: adminUrl });
    await adminClient.connect();

    // Create an empty table for testing empty table message
    await adminClient.query(`
      CREATE TABLE IF NOT EXISTS empty_sample_test (
        id INT PRIMARY KEY,
        note TEXT
      );
      GRANT SELECT ON empty_sample_test TO pgmoat_reader;
    `);

    const raw = await introspect(adminClient, ['public']);

    const config = PgmoatConfig.parse({
      version: 1,
      server: { name: 'test-sample-server' },
      connection: { url, schemas: ['public'] },
      budgets: {
        max_rows: 200,
        max_query_ms: 5000,
        lock_timeout_ms: 1000,
      },
      tables: {
        users: {
          columns: {
            password_hash: { hidden: true },
            mfa_secret: { hidden: true },
            email: { sensitive: 'high' },
          },
        },
        internal_audit: {
          hidden: true,
        },
      },
    });

    snapshot = buildSnapshot(raw, config);
    pools = createPools(config);

    deps = {
      config,
      instanceId: 'inst-sample-test',
      transport: 'stdio',
      pools,
      schemaCache: {
        get: () => snapshot,
      } as unknown as SchemaCache,
      audit: {
        emit: (entry: AuditEntry) => {
          emittedAudit.push(entry);
        },
      },
    };
  }, 60000);

  afterAll(async () => {
    if (adminClient) {
      await adminClient.query('DROP TABLE IF EXISTS empty_sample_test').catch(() => {});
      await adminClient.end().catch(() => {});
    }
    if (pools) await pools.end().catch(() => {});
  }, 30000);

  it('samples 5 random rows from users table', async () => {
    emittedAudit = [];
    const res = await sampleTableTool(
      { table: 'users', limit: 5 },
      {},
      deps,
    );

    expect(res).not.toHaveProperty('isError');
    const structured = (res as unknown as ResultWithStructured).structuredContent!;
    expect(structured.row_count).toBeLessThanOrEqual(5);
    expect(structured.row_count).toBeGreaterThan(0);
    expect(res.content[0]?.text).toContain('Returned');
    expect(res.content[0]?.text).toContain('<<<pgmoat:data');

    expect(emittedAudit.length).toBe(1);
    expect(emittedAudit[0]?.status).toBe('success');
    expect(emittedAudit[0]?.sql_executed).toContain('LIMIT 5');
    expect(emittedAudit[0]?.sql_executed).toContain('random()');
  });

  it('masks medium and high sensitive columns as [masked]', async () => {
    emittedAudit = [];
    const res = await sampleTableTool(
      { table: 'users', limit: 5 },
      {},
      deps,
    );

    expect(res).not.toHaveProperty('isError');
    const structured = (res as unknown as ResultWithStructured).structuredContent!;
    const emailCol = structured.columns.find((c) => c.name === 'email');
    expect(emailCol).toBeDefined();
    expect(emailCol?.masked).toBe(true);

    for (const row of structured.rows) {
      if (row['email'] !== null) {
        expect(row['email']).toBe('[masked]');
      }
    }

    expect(res.content[0]?.text).toContain('[masked]');
  });

  it('omits hidden columns from sample output', async () => {
    emittedAudit = [];
    const res = await sampleTableTool(
      { table: 'users', limit: 5 },
      {},
      deps,
    );

    expect(res).not.toHaveProperty('isError');
    const structured = (res as unknown as ResultWithStructured).structuredContent!;
    const hiddenCol = structured.columns.find((c) => c.name === 'password_hash' || c.name === 'mfa_secret');
    expect(hiddenCol).toBeUndefined();

    for (const row of structured.rows) {
      expect(row['password_hash']).toBeUndefined();
      expect(row['mfa_secret']).toBeUndefined();
    }

    expect(res.content[0]?.text).not.toContain('password_hash');
    expect(res.content[0]?.text).not.toContain('mfa_secret');
  });

  it('refuses sampling a hidden or unknown table with PGM-207', async () => {
    emittedAudit = [];
    const resHidden = await sampleTableTool(
      { table: 'internal_audit' },
      {},
      deps,
    );

    expect(resHidden).toHaveProperty('isError', true);
    expect(resHidden._meta['com.kitalonlabs.pgmoat/error_code']).toBe('PGM-207');
    expect(resHidden.content[0]?.text).toContain('PGM-207');

    const resUnknown = await sampleTableTool(
      { table: 'completely_nonexistent' },
      {},
      deps,
    );

    expect(resUnknown).toHaveProperty('isError', true);
    expect(resUnknown._meta['com.kitalonlabs.pgmoat/error_code']).toBe('PGM-207');
    expect(resUnknown.content[0]?.text).toContain('PGM-207');
  });

  it('uses TABLESAMPLE SYSTEM when row_estimate > 1,000,000', async () => {
    emittedAudit = [];

    // Simulate events relation having rowEstimate = 2,000,000
    const eventsRel = snapshot.relations.find((r) => r.name === 'events');
    expect(eventsRel).toBeDefined();

    const originalEstimate = eventsRel!.rowEstimate;
    eventsRel!.rowEstimate = 2_000_000;

    try {
      const res = await sampleTableTool(
        { table: 'events', limit: 3 },
        {},
        deps,
      );

      expect(res).not.toHaveProperty('isError');
      expect(emittedAudit.length).toBe(1);
      expect(emittedAudit[0]?.sql_executed).toMatch(/TABLESAMPLE\s+system/i);
    } finally {
      eventsRel!.rowEstimate = originalEstimate;
    }
  });

  it('returns empty table message when table has 0 rows', async () => {
    emittedAudit = [];
    const res = await sampleTableTool(
      { table: 'empty_sample_test' },
      {},
      deps,
    );

    expect(res).not.toHaveProperty('isError');
    const structured = (res as unknown as ResultWithStructured).structuredContent!;
    expect(structured.row_count).toBe(0);
    expect(res.content[0]?.text).toMatch(/Table (.*)is empty\./i);
    expect(res.content[0]?.text).not.toContain('<<<pgmoat:data');

    expect(emittedAudit.length).toBe(1);
    expect(emittedAudit[0]?.status).toBe('success');
    expect(emittedAudit[0]?.rows_returned).toBe(0);
  });
});
