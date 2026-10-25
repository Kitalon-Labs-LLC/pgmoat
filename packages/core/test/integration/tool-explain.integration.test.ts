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
import { explainTool } from '../../src/tools/explain.js';
import type { ToolDeps } from '../../src/tools/context.js';
import type { AuditEntry } from '../../src/types.js';
import type { SchemaCache } from '../../src/schema/cache.js';
import type { ExplainResultT } from '../../src/output/schemas.js';

interface ResultWithStructured {
  structuredContent?: ExplainResultT;
}

describe('explain tool integration (P6.6)', () => {
  let adminClient: pg.Client;
  let pools: Pools;
  let emittedAudit: AuditEntry[] = [];
  let deps: ToolDeps;

  beforeAll(async () => {
    await startPostgres();
    const url = connectionUrl('pgmoat_reader');
    const adminUrl = connectionUrl('postgres');

    adminClient = new pg.Client({ connectionString: adminUrl });
    await adminClient.connect();

    const raw = await introspect(adminClient, ['public']);

    const config = PgmoatConfig.parse({
      version: 1,
      server: { name: 'test-explain-server' },
      connection: { url, schemas: ['public'] },
      budgets: {
        max_rows: 200,
        max_query_ms: 5000,
        max_explain_ms: 5000,
        lock_timeout_ms: 1000,
      },
      tables: {
        users: {
          columns: {
            password_hash: { hidden: true },
            mfa_secret: { hidden: true },
          },
        },
        internal_audit: {
          hidden: true,
        },
      },
    });

    const snapshot = buildSnapshot(raw, config);
    pools = createPools(config);

    deps = {
      config,
      instanceId: 'inst-explain-test',
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
    if (adminClient) await adminClient.end().catch(() => {});
    if (pools) await pools.end().catch(() => {});
  }, 30000);

  it('generates plan for a join and never includes ANALYZE in emitted SQL', async () => {
    emittedAudit = [];
    const res = await explainTool(
      { sql: 'SELECT u.id, o.amount FROM users u JOIN orders o ON u.id = o.user_id' },
      {},
      deps,
    );

    expect(res).not.toHaveProperty('isError');
    const structured = (res as unknown as ResultWithStructured).structuredContent!;
    expect(structured.plan_summary).toBeDefined();
    expect(typeof structured.plan_summary.top_node_type).toBe('string');
    expect(structured.plan_summary.top_node_type.length).toBeGreaterThan(0);
    expect(structured.plan_summary.total_cost).toBeGreaterThanOrEqual(0);
    expect(structured.plan_summary.plan_rows).toBeGreaterThanOrEqual(0);

    expect(res.content[0]?.text).toContain('Plan summary:');
    expect(res.content[0]?.text).toContain('Plan tree:');
    expect(res.content[0]?.text).not.toContain('ANALYZE');

    expect(emittedAudit.length).toBe(1);
    expect(emittedAudit[0]?.status).toBe('success');
    expect(emittedAudit[0]?.sql_executed).toMatch(/^EXPLAIN/i);
    expect(emittedAudit[0]?.sql_executed).not.toMatch(/\banalyze\b/i);
  });

  it('refuses DELETE query with PGM-201', async () => {
    emittedAudit = [];
    const res = await explainTool(
      { sql: "DELETE FROM users WHERE email = 'test@example.com'" },
      {},
      deps,
    );

    expect(res).toHaveProperty('isError', true);
    expect(res._meta['com.kitalonlabs.pgmoat/error_code']).toBe('PGM-201');
    expect(res.content[0]?.text).toContain('PGM-201');

    expect(emittedAudit.length).toBe(1);
    expect(emittedAudit[0]?.status).toBe('refused');
    expect(emittedAudit[0]?.error_code).toBe('PGM-201');
  });

  it('answers a hidden column exactly like a missing column', async () => {
    emittedAudit = [];
    const res = await explainTool(
      { sql: 'SELECT password_hash FROM users' },
      {},
      deps,
    );

    expect(res).toHaveProperty('isError', true);
    expect(res._meta['com.kitalonlabs.pgmoat/error_code']).toBe('PGM-506');
    expect(res.content[0]?.text).toContain('column "password_hash" does not exist');

    // The audit log still records the attempt as a refusal for the operator
    expect(emittedAudit.length).toBe(1);
    expect(emittedAudit[0]?.status).toBe('refused');
    expect(emittedAudit[0]?.error_code).toBe('PGM-506');

    // The agent cannot tell it apart from a column that does not exist
    const missing = await explainTool(
      { sql: 'SELECT password_hasx FROM users' },
      {},
      deps,
    );
    expect(missing.content[0]?.text).toBe(
      res.content[0]?.text.replace('password_hash', 'password_hasx'),
    );
  });

  it('refuses query referencing hidden table with PGM-207', async () => {
    emittedAudit = [];
    const res = await explainTool(
      { sql: 'SELECT id FROM internal_audit' },
      {},
      deps,
    );

    expect(res).toHaveProperty('isError', true);
    expect(res._meta['com.kitalonlabs.pgmoat/error_code']).toBe('PGM-207');
    expect(res.content[0]?.text).toContain('PGM-207');

    expect(emittedAudit.length).toBe(1);
    expect(emittedAudit[0]?.status).toBe('refused');
    expect(emittedAudit[0]?.error_code).toBe('PGM-207');
  });

  it('maps timeout to PGM-308 when max_explain_ms is exceeded', async () => {
    emittedAudit = [];

    const timeoutConfig = PgmoatConfig.parse({
      ...deps.config,
      budgets: {
        ...deps.config.budgets,
        max_explain_ms: 100,
      },
    });

    const timeoutDeps: ToolDeps = {
      ...deps,
      config: timeoutConfig,
    };

    // Construct a query whose planning time or execution times out, or mock timeout mapping
    // To trigger statement timeout in PostgreSQL during EXPLAIN:
    // A query with hundreds of unconstrained joins (e.g. from 20 tables) forces genetic query optimization (GEQO) or huge join search space,
    // or we can test that when executeRead throws PGM-303, explain maps it to PGM-308.
    // Let's verify with a mock pool that throws PGM-303
    const mockTimeoutDeps: ToolDeps = {
      ...timeoutDeps,
      pools: {
        query: {
          connect: async () => ({
            processID: 12345,
            query: (sqlOrConfig: unknown) => {
              if (typeof sqlOrConfig === 'string') {
                return Promise.resolve({ rows: [] });
              }
              // It is the Cursor instance
              return {
                read: (_limit: number, cb: (err: unknown) => void) => {
                  const err = new Error('canceling statement due to statement timeout');
                  (err as unknown as { code: string }).code = '57014';
                  cb(err);
                },
                close: async () => {},
              };
            },
            release: () => {},
          }),
        } as unknown as Pools['query'],
        control: deps.pools!.control,
        end: async () => {},
      },
    };

    const res = await explainTool(
      { sql: 'SELECT 1 AS one' },
      {},
      mockTimeoutDeps,
    );

    expect(res).toHaveProperty('isError', true);
    expect(res._meta['com.kitalonlabs.pgmoat/error_code']).toBe('PGM-308');
    expect(res.content[0]?.text).toContain('PGM-308');

    expect(emittedAudit.length).toBe(1);
    expect(emittedAudit[0]?.status).toBe('error');
    expect(emittedAudit[0]?.error_code).toBe('PGM-308');
  });
});
