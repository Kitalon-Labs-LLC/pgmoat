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
import { queryTool } from '../../src/tools/query.js';
import type { ToolDeps } from '../../src/tools/context.js';
import type { AuditEntry } from '../../src/types.js';
import type { SchemaCache } from '../../src/schema/cache.js';
import type { QueryResults } from '../../src/output/schemas.js';

interface ResultWithStructured {
  structuredContent?: QueryResults;
}

describe('query tool integration (P6.5)', () => {
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
      server: { name: 'test-query-server' },
      connection: { url, schemas: ['public'] },
      budgets: {
        max_rows: 200,
        max_query_ms: 5000,
        lock_timeout_ms: 1000,
      },
      rls: {
        required: false,
        trust_request_meta: true,
        protected_tables: ['orders', 'tickets', 'customers'],
        session_variables: {
          'app.tenant_id': 'meta.tenant_id',
        },
      },
      tables: {
        users: {
          columns: {
            password_hash: { hidden: true },
            mfa_secret: { hidden: true },
          },
        },
        orders: {
          columns: {
            status: { untrusted: true },
          },
        },
      },
    });

    const snapshot = buildSnapshot(raw, config);

    pools = createPools(config);

    deps = {
      config,
      instanceId: 'inst-query-test',
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

  it('runs simple SELECT 1 AS one successfully', async () => {
    emittedAudit = [];
    const res = await queryTool({ sql: 'SELECT 1 AS one' }, {}, deps);

    expect(res).not.toHaveProperty('isError');
    const structured = (res as unknown as ResultWithStructured).structuredContent!;
    expect(structured.row_count).toBe(1);
    expect(structured.rows[0]?.['one']).toBe(1);
    expect(res.content[0]?.text).toContain('Returned 1 row');
    expect(res.content[0]?.text).toContain('| one |');
    expect(res._meta['com.kitalonlabs.pgmoat/request_id']).toBeDefined();

    expect(emittedAudit.length).toBe(1);
    expect(emittedAudit[0]?.status).toBe('success');
    expect(emittedAudit[0]?.rows_returned).toBe(1);
  });

  it('caps at 200 rows with PGM-301 when query returns > 200 rows', async () => {
    emittedAudit = [];
    const res = await queryTool(
      { sql: 'SELECT s AS num FROM generate_series(1, 350) AS s' },
      {},
      deps,
    );

    expect(res).not.toHaveProperty('isError');
    const structured = (res as unknown as ResultWithStructured).structuredContent!;
    expect(structured.row_count).toBe(200);
    expect(structured.truncated).toBe(true);
    expect(structured.warnings?.some((w) => w.code === 'PGM-301')).toBe(true);

    expect(res.content[0]?.text).toContain('200-row limit (PGM-301)');
    expect(res.content[0]?.text).toContain('Narrow the query with WHERE or ORDER BY');

    expect(emittedAudit.length).toBe(1);
    expect(emittedAudit[0]?.status).toBe('success');
    expect(emittedAudit[0]?.rows_returned).toBe(200);
    expect(emittedAudit[0]?.warnings.some((w) => w.includes('PGM-301'))).toBe(true);
  });

  it('refuses LIMIT 5000 with PGM-302', async () => {
    emittedAudit = [];
    const res = await queryTool(
      { sql: 'SELECT s FROM generate_series(1, 5000) AS s LIMIT 5000' },
      {},
      deps,
    );

    expect(res).toHaveProperty('isError', true);
    expect(res._meta['com.kitalonlabs.pgmoat/error_code']).toBe('PGM-302');
    expect(res.content[0]?.text).toContain('PGM-302');
    expect(res.content[0]?.text).toContain('LIMIT 5000 is above this server\'s limit of 200 rows');

    expect(emittedAudit.length).toBe(1);
    expect(emittedAudit[0]?.status).toBe('refused');
    expect(emittedAudit[0]?.error_code).toBe('PGM-302');
  });

  it('refuses query accessing hidden column with PGM-208', async () => {
    emittedAudit = [];
    const res = await queryTool(
      { sql: 'SELECT password_hash FROM users' },
      {},
      deps,
    );

    expect(res).toHaveProperty('isError', true);
    expect(res._meta['com.kitalonlabs.pgmoat/error_code']).toBe('PGM-208');
    expect(res.content[0]?.text).toContain('PGM-208');

    expect(emittedAudit.length).toBe(1);
    expect(emittedAudit[0]?.status).toBe('refused');
    expect(emittedAudit[0]?.error_code).toBe('PGM-208');
  });

  it('enforces tenant scoping when RLS is configured', async () => {
    // Tenant 1
    const tenant1Id = 'a0000000-0000-0000-0000-000000000001';
    const ctxTenant1 = {
      mcpReq: {
        _meta: {
          'com.kitalonlabs.pgmoat/rls': {
            tenant_id: tenant1Id,
          },
        },
      },
    };

    const res1 = await queryTool(
      { sql: 'SELECT id, tenant_id FROM orders' },
      ctxTenant1,
      deps,
    );

    expect(res1).not.toHaveProperty('isError');
    const structured1 = (res1 as unknown as ResultWithStructured).structuredContent!;
    for (const row of structured1.rows) {
      expect(row['tenant_id']).toBe(tenant1Id);
    }

    // Different tenant ID
    const emptyTenantId = '99999999-9999-9999-9999-999999999999';
    const ctxEmpty = {
      mcpReq: {
        _meta: {
          'com.kitalonlabs.pgmoat/rls': {
            tenant_id: emptyTenantId,
          },
        },
      },
    };

    const res2 = await queryTool(
      { sql: 'SELECT id, tenant_id FROM orders' },
      ctxEmpty,
      deps,
    );

    expect(res2).not.toHaveProperty('isError');
    const structured2 = (res2 as unknown as ResultWithStructured).structuredContent!;
    expect(structured2.row_count).toBe(0);
  });

  it('handles query timeout mapping to PGM-303', async () => {
    emittedAudit = [];

    // Temporary deps with 100 ms query budget
    const timeoutConfig = PgmoatConfig.parse({
      ...deps.config,
      budgets: {
        ...deps.config.budgets,
        max_query_ms: 100,
      },
    });

    const timeoutDeps: ToolDeps = {
      ...deps,
      config: timeoutConfig,
    };

    // Sorting 3 million rows cannot return first cursor row before sorting is complete, exceeding 100 ms
    const res = await queryTool(
      {
        sql: 'SELECT a.s FROM generate_series(1, 3000000) AS a(s) ORDER BY a.s DESC',
      },
      {},
      timeoutDeps,
    );

    expect(res).toHaveProperty('isError', true);
    expect(res._meta['com.kitalonlabs.pgmoat/error_code']).toBe('PGM-303');
    expect(res.content[0]?.text).toContain('PGM-303');

    expect(emittedAudit.length).toBe(1);
    expect(emittedAudit[0]?.status).toBe('error');
    expect(emittedAudit[0]?.error_code).toBe('PGM-303');
  });

  it('handles zero rows: returns 0 rows without fence block', async () => {
    emittedAudit = [];
    const res = await queryTool(
      { sql: 'SELECT id, email FROM users WHERE false' },
      {},
      deps,
    );

    expect(res).not.toHaveProperty('isError');
    const structured = (res as unknown as ResultWithStructured).structuredContent!;
    expect(structured.row_count).toBe(0);
    expect(res.content[0]?.text).toContain('Returned 0 rows');
    expect(res.content[0]?.text).not.toContain('<<<pgmoat:data');

    expect(emittedAudit.length).toBe(1);
    expect(emittedAudit[0]?.status).toBe('success');
    expect(emittedAudit[0]?.rows_returned).toBe(0);
  });
});
