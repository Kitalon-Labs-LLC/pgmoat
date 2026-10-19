import { describe, it, expect } from 'vitest';
import { formatStartBanner, printDoctorRefusalBanner } from '../src/commands/start.js';
import { DoctorEnforceError, type PgmoatConfigT, PGMOAT_VERSION } from '@pgmoat/core';

describe('CLI start & validate (P8.2)', () => {
  it('formats start banner matching spec/06 section 2.7', () => {
    const config: PgmoatConfigT = {
      version: 1,
      server: {
        name: 'acme-support',
        description: 'Acme production database for the support agent.',
      },
      transport: 'stdio',
      connection: {
        url: 'postgresql://readonly_agent@db.internal:5432/app',
        schemas: ['public'],
        pool: { max: 10, min: 2, idle_timeout_ms: 10000, connection_timeout_ms: 5000 },
        ssl: { mode: 'prefer', reject_unauthorized: false },
      },
      mode: 'read-only',
      budgets: {
        max_rows: 200,
        max_query_ms: 5000,
        max_payload_bytes: 65536,
        max_columns: 50,
        max_cell_chars: 500,
        max_explain_ms: 1000,
        max_sql_chars: 65536,
      },
      rls: {
        required: true,
        session_variables: {
          'app.tenant_id': 'env.PGMOAT_TENANT_ID',
        },
        protected_tables: [],
      },
      policy: {
        allow_catalog_queries: false,
      },
      audit: {
        destination: 'file',
        path: '/Users/dev/acme/pgmoat-audit/',
        buffer_size: 1000,
        flush_interval_ms: 1000,
      },
      schema: {
        cache_ttl_ms: 3600000,
        refresh_interval_ms: 0,
        annotate_strict: false,
      },
      tables: {},
      doctor: {
        on_start: 'enforce',
      },
      log: {
        level: 'info',
      },
    };

    const banner = formatStartBanner(config, '/Users/dev/acme/pgmoat.yaml', {
      snapshot: {
        relations: Array.from({ length: 41 }, (_, i) => ({ qualifiedName: `public.table_${i}` })),
        policyIndex: {
          hiddenRelations: new Set(['public.table_0', 'public.table_1']),
          hiddenColumns: new Map([
            ['public.users', new Set(['col1', 'col2', 'col3', 'col4', 'col5', 'col6'])],
          ]),
        },
      },
      dbVersion: '17.6',
      currentUser: 'readonly_agent',
      dbHost: 'db.internal',
      dbPort: 5432,
      dbName: 'app',
    });

    expect(banner).toContain(`pgmoat ${PGMOAT_VERSION}  acme-support  read-only`);
    expect(banner).toContain('config     /Users/dev/acme/pgmoat.yaml');
    expect(banner).toContain('transport  stdio  (MCP 2026-07-28 and 2025-11-25)');
    expect(banner).toContain('database   db.internal:5432/app  Postgres 17.6  role readonly_agent');
    expect(banner).toContain('schema     39 visible relations, 2 hidden, 6 hidden columns');
    expect(banner).toContain('tools      describe_table, explain, list_tables, query, sample_table');
    expect(banner).toContain('budgets    200 rows, 5000 ms, 64 KB, 50 columns');
    expect(banner).toContain('rls        app.tenant_id <- env.PGMOAT_TENANT_ID (required)');
    expect(banner).toContain('audit      file  /Users/dev/acme/pgmoat-audit/');
    expect(banner).toContain('doctor     ok');
    expect(banner).toContain('ready');
  });

  it('prints doctor refusal banner per spec/06 section 2.7', () => {
    const error = new DoctorEnforceError([
      {
        code: 'PGM-702',
        severity: 'fail',
        subject: 'role svc_agent',
        message: 'role svc_agent has BYPASSRLS, so row-level security does not apply to it',
        fix: 'ALTER ROLE svc_agent NOBYPASSRLS;',
      },
    ]);

    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as unknown as typeof process.stderr.write;

    try {
      printDoctorRefusalBanner(error);
      const out = stderrChunks.join('');
      expect(out).toContain('pgmoat did not start: the database role failed safety checks.');
      expect(out).toContain('PGM-702');
      expect(out).toContain('role svc_agent has BYPASSRLS');
      expect(out).toContain('Fix: ALTER ROLE svc_agent NOBYPASSRLS;');
      expect(out).toContain('pass --allow-unsafe-role');
      expect(out).toContain('https://pgmoat.dev/docs/errors/PGM-702');
    } finally {
      process.stderr.write = origWrite;
    }
  });
});

