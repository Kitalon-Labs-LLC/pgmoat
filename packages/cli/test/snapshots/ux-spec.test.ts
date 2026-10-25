import { describe, it, expect } from 'vitest';
import { HELP_TEXT } from '../../src/bin.js';
import { formatStartBanner } from '../../src/commands/start.js';
import { buildDoctorReport, renderDoctorHuman } from '../../src/commands/doctor.js';
import { renderVerifyHuman, formatTailRow, formatQueryRow } from '../../src/commands/audit.js';
import { renderClientSnippets } from '../../src/commands/init.js';
import {
  formatZeroConfigNotice,
  type DoctorFinding,
  type VerifyReport,
  type AuditEntry,
  type Runtime,
  type PgmoatConfigT,
} from '@pgmoat/core';

describe('CLI UX Spec Snapshots (P8.7 - spec/06 section 2)', () => {
  // Helper to normalize variable parts: timestamps, paths, durations, versions, hashes
  function normalize(str: string): string {
    return str
      .replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{3}Z)?/g, '<TIMESTAMP>')
      .replace(/\/([a-zA-Z0-9_-]+\/)+[a-zA-Z0-9_.-]+/g, '<PATH>')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>')
      .replace(/\b\d+ ms\b/g, '<DURATION>')
      .replace(/pgmoat \d+\.\d+\.\d+/g, 'pgmoat <VERSION>');
  }

  it('2.12 Help snapshot matches spec character-for-character', () => {
    const expected = `pgmoat  Governed Postgres access for AI agents.

Usage
  pgmoat <postgres-url>            Start with safe defaults (no config file)
  pgmoat <command> [options]

Commands
  init            Create pgmoat.yaml for a database
  start           Start the MCP server
  validate        Check pgmoat.yaml against the schema and the database
  doctor          Check the database role for unsafe privileges
  audit           tail | query | verify | prune audit logs
  schema-export   Write the visible schema as Markdown
  test-corpus     Run the adversarial safety corpus against a scratch database
  version         Show versions

Options
  --config <path>     Config file (default: ./pgmoat.yaml)
  --url-env <VAR>     Read the connection URL from an environment variable
  --json              Machine-readable output
  --no-color          Disable colors (NO_COLOR is also honored)
  -h, --help          Show help

Docs     https://kitalonlabs.com/pgmoat/docs
Issues   https://github.com/Kitalon-Labs-LLC/pgmoat/issues`;

    expect(HELP_TEXT).toBe(expected);
  });

  it('2.4 Zero-config notice snapshot', () => {
    const mockRuntime = {
      config: {
        mode: 'read-only',
        transport: 'stdio',
        connection: {
          url: 'postgresql://readonly_agent@db.internal:5432/app',
          schemas: ['public'],
        },
        budgets: {
          max_rows: 200,
          max_query_ms: 5000,
          max_payload_bytes: 65536,
        },
        audit: {
          destination: 'file',
          path: '/home/dev/.local/state/pgmoat/audit/audit-2026-12-08.ndjson',
        },
      },
      schemaCache: {
        get: () => ({
          serverVersionNum: 170006,
          relations: [
            ...Array.from({ length: 37 }, (_, i) => ({
              kind: 'table',
              name: `table_${i}`,
              qualifiedName: `public.table_${i}`,
            })),
            ...Array.from({ length: 4 }, (_, i) => ({
              kind: 'view',
              name: `view_${i}`,
              qualifiedName: `public.view_${i}`,
            })),
          ],
        }),
      },
      doctorFindings: [
        {
          code: 'PGM-706',
          message: 'role can write to 37 tables (read-only mode still blocks writes)',
        },
      ],
      currentUser: 'readonly_agent',
    };

    const notice = formatZeroConfigNotice(mockRuntime as unknown as Runtime, {
      fromArgvPassword: true,
    });

    const normalized = normalize(notice);
    expect(normalized).toContain('pgmoat <VERSION>  zero-config  read-only  stdio');
    expect(normalized).toContain('database   db.internal:5432/app (Postgres 17.6), role readonly_agent');
    expect(normalized).toContain('schema     37 tables, 4 views in public');
    expect(normalized).toContain('budgets    200 rows, <DURATION>, 64 KB per result');
    expect(normalized).toContain('audit      <PATH>');
    expect(normalized).toContain('doctor     ! PGM-706 role can write to 37 tables (read-only mode still blocks writes)');
    expect(normalized).toContain('next       run `npx pgmoat init` to add descriptions and hide sensitive columns');
    expect(normalized).toContain('!          the connection URL is visible in process listings; prefer --url-env PGMOAT_DATABASE_URL');
  });

  it('2.7 Start banner stdio snapshot', () => {
    const mockConfig = {
      version: '1',
      server: { name: 'acme-support' },
      mode: 'read-only',
      transport: 'stdio',
      connection: {
        url: 'postgresql://readonly_agent@db.internal:5432/app',
        schemas: ['public'],
      },
      budgets: {
        max_rows: 200,
        max_query_ms: 5000,
        max_payload_bytes: 65536,
        max_columns: 50,
      },
      rls: {
        session_variables: {
          'app.tenant_id': 'env.PGMOAT_TENANT_ID',
        },
        required: true,
      },
      audit: {
        destination: 'file',
        path: '/Users/dev/acme/pgmoat-audit/',
      },
    } as unknown as PgmoatConfigT;

    const mockRuntime = {
      snapshot: {
        relations: Array.from({ length: 41 }, (_, i) => ({ qualifiedName: `public.t_${i}` })),
        policyIndex: {
          hiddenRelations: new Set(['public.t_0', 'public.t_1']),
          hiddenColumns: new Map([
            ['public.t_2', new Set(['col1', 'col2', 'col3'])],
            ['public.t_3', new Set(['col4', 'col5', 'col6'])],
          ]),
        },
      },
      dbVersion: '17.6',
      currentUser: 'readonly_agent',
      dbHost: 'db.internal',
      dbPort: 5432,
      dbName: 'app',
    };

    const banner = formatStartBanner(mockConfig, '/Users/dev/acme/pgmoat.yaml', mockRuntime);

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

  it('2.7 Doctor refusal at start snapshot', () => {
    const refusal = [
      'x pgmoat did not start: the database role failed safety checks.',
      '',
      '  x PGM-702  role svc_agent has BYPASSRLS, so row-level security does not apply to it',
      '     Fix: ALTER ROLE svc_agent NOBYPASSRLS;',
      '',
      '  Run `pgmoat doctor` for all findings. To start anyway (not recommended),',
      '  pass --allow-unsafe-role. Every audit entry will record the override.',
      '',
      '  https://kitalonlabs.com/pgmoat/docs/errors/PGM-702',
    ].join('\n');

    expect(refusal).toContain('x pgmoat did not start: the database role failed safety checks.');
    expect(refusal).toContain('pass --allow-unsafe-role. Every audit entry will record the override.');
    expect(refusal).toContain('https://kitalonlabs.com/pgmoat/docs/errors/PGM-702');
  });

  it('2.5 Init client snippets snapshot', () => {
    const snippets = renderClientSnippets('acme-support', '/Users/dev/acme/pgmoat.yaml', 'postgresql://readonly_agent@db.internal:5432/app');

    expect(snippets).toContain('Claude Code');
    expect(snippets).toContain('claude mcp add acme-support -- npx -y pgmoat start --config /Users/dev/acme/pgmoat.yaml');
    expect(snippets).toContain('"acme-support": {');
    expect(snippets).toContain('"command": "npx"');
    expect(snippets).toContain('"PGMOAT_DATABASE_URL": "postgresql://readonly_agent@db.internal:5432/app"');
  });

  it('2.6 Init error states snapshot', () => {
    const connRefused = [
      '  Connecting to db.internal:5432/app ... x',
      '',
      'x PGM-101  Cannot connect to Postgres at db.internal:5432',
      '',
      '  Error: connect ECONNREFUSED 10.0.4.12:5432',
      '',
      '  Fix: check that Postgres is running and reachable:',
      '       pg_isready -h db.internal -p 5432',
      '',
      '  https://kitalonlabs.com/pgmoat/docs/errors/PGM-101',
    ].join('\n');

    expect(connRefused).toContain('x PGM-101  Cannot connect to Postgres');
    expect(connRefused).toContain('pg_isready -h db.internal -p 5432');

    const mergeReport = [
      '  Kept 41 descriptions and 6 hidden columns.',
      '  Added 2 tables and 9 columns.',
      '  Marked 1 table as STALE (not found in database).',
      'ok Updated pgmoat.yaml',
    ].join('\n');

    expect(mergeReport).toContain('Kept 41 descriptions and 6 hidden columns.');
    expect(mergeReport).toContain('Marked 1 table as STALE');
  });

  it('2.8 Validate warnings snapshot', () => {
    const warningsText = [
      '3 warnings',
      '  ! pgmoat.yaml:44   public.orders has no description; the agent will see "Unannotated"',
      '  ! pgmoat.yaml:88   public.refunds.reason marked untrusted but not described',
      '  ! pgmoat.yaml:131  billing.invoices.tax_id: column not found in database (STALE)',
    ].join('\n');

    expect(warningsText).toContain('3 warnings');
    expect(warningsText).toContain('public.orders has no description');
    expect(warningsText).toContain('column not found in database (STALE)');
  });

  it('2.9 Doctor report snapshot', () => {
    const findings: DoctorFinding[] = [
      {
        code: 'PGM-705',
        severity: 'warn',
        subject: 'public.users',
        message: 'can SELECT 2 hidden columns',
        fix: 'REVOKE SELECT (password_hash) ON public.users FROM readonly_agent;\nREVOKE SELECT (mfa_secret) ON public.users FROM readonly_agent;',
      },
    ];

    const report = buildDoctorReport(
      'readonly_agent',
      'db.internal',
      5432,
      'app',
      '17.6',
      ['orders', 'tickets', 'customers'],
      findings,
    );
    const output = renderDoctorHuman(report);

    expect(output).toContain('pgmoat doctor  role readonly_agent on db.internal:5432/app (Postgres 17.6)');
    expect(output).toContain('ok PGM-701  not a superuser');
    expect(output).toContain('ok PGM-702  no BYPASSRLS');
    expect(output).toContain('!  PGM-705  can SELECT 2 hidden columns');
    expect(output).toContain('REVOKE SELECT (password_hash) ON public.users FROM readonly_agent;');
    expect(output).toContain('Result: 0 failures, 1 warning.');
  });

  it('2.10 Audit tail & query snapshot', () => {
    const entry: AuditEntry = {
      request_id: '01JAB3456789',
      instance_id: '01JAB300000000000000000000',
      seq: 0,
      ts: '2026-12-08T14:23:11.000Z',
      transport: 'stdio',
      protocol_version: '2024-11-05',
      client_name: 'claude-code',
      client_version: '2.9.1',
      principal: 'local',
      trace_id: null,
      tool: 'query',
      params: { sql: 'SELECT 1' },
      sql_executed: 'SELECT 1',
      sql_fingerprint: 'fp_123',
      rls_context: null,
      status: 'success',
      error_code: null,
      error_message: null,
      warnings: [],
      rows_returned: 1,
      rows_affected: null,
      duration_ms: 31,
      budget_max_rows: 200,
      budget_max_query_ms: 5000,
      payload_bytes: 42,
      prev_hash: '',
      entry_hash: '',
      dropped_since_last: 0,
      unsafe_role_override: false,
      pgmoat_version: '1.0.0',
      server_name: 'acme-support',
    };

    const tail = formatTailRow(entry);
    expect(tail).toBe('2026-12-08 14:23:11  01JAB3..  claude-code 2.9.1  local      query           success   1 row     31 ms');

    const queryEntry: AuditEntry = {
      ...entry,
      request_id: '01JA9X123456',
      ts: '2026-11-02T09:11:22.000Z',
      principal: 'user_8812',
      status: 'refused',
      error_code: 'PGM-207',
      sql_executed: 'SELECT * FROM internal_audit',
    };

    const query = formatQueryRow(queryEntry);
    expect(query).toBe('01JA9X..  2026-11-02 09:11:22  user_8812  query  PGM-207  SELECT * FROM internal_audit');
  });

  it('2.10 Audit verify snapshot', () => {
    const report: VerifyReport = {
      allIntact: false,
      totalEntries: 18422,
      instances: [
        {
          instanceId: '01JA7Q00000000000000000000',
          status: 'intact',
          totalEntries: 9121,
          firstSeq: 0,
          lastSeq: 9120,
          intact: true,
          droppedRecorded: 0,
          reordered: false,
        },
        {
          instanceId: '01JA9B00000000000000000000',
          status: 'intact',
          totalEntries: 4411,
          firstSeq: 0,
          lastSeq: 4410,
          intact: true,
          droppedRecorded: 0,
          reordered: false,
        },
        {
          instanceId: '01JAA000000000000000000000',
          status: 'intact',
          totalEntries: 2211,
          firstSeq: 0,
          lastSeq: 2210,
          intact: true,
          droppedRecorded: 2,
          reordered: false,
        },
        {
          instanceId: '01JAB000000000000000000000',
          status: 'edited',
          totalEntries: 2679,
          firstSeq: 0,
          lastSeq: 2678,
          intact: false,
          badSeq: 1203,
          droppedRecorded: 0,
          reordered: false,
        },
      ],
    };

    const verifyOutput = renderVerifyHuman(3, report);
    expect(verifyOutput).toContain('Verifying 3 files, 4 instances, 18,422 entries ...');
    expect(verifyOutput).toContain('ok instance 01JA7Q..  seq 0..9120     intact');
    expect(verifyOutput).toContain('ok instance 01JA9B..  seq 0..4410     intact');
    expect(verifyOutput).toContain('!  instance 01JAA0..  seq 0..2210     2 dropped entries recorded (buffer overflow)');
    expect(verifyOutput).toContain('x  instance 01JAB0..  seq 0..2678     hash mismatch at seq 1203 (entry edited or corrupted)');
    expect(verifyOutput).toContain('Result: 1 instance failed verification.');
  });

  it('2.11 Test-corpus output snapshot', () => {
    const specimen = [
      'Seeding schema pgmoat_corpus_k3f9 ... ok',
      'Running 318 cases against Postgres 17.6',
      '',
      'allowed      82/82   ok',
      'statements   41/41   ok',
      'stacking     15/15   ok',
      'cte          16/16   ok',
      'functions    44/44   ok',
      'sql-exec     15/15   ok',
      'locking       8/8    ok',
      'explain       8/8    ok',
      'policy       62/62   ok',
      'budgets      11/11   ok',
      'edge         16/16   ok',
      '',
      '318 passed, 0 failed.  Dropped schema pgmoat_corpus_k3f9.',
    ].join('\n');

    expect(specimen).toContain('allowed      82/82   ok');
    expect(specimen).toContain('locking       8/8    ok');
    expect(specimen).toContain('318 passed, 0 failed.  Dropped schema pgmoat_corpus_k3f9.');

    const refusalSpecimen = [
      'x test-corpus refuses to run: the database has 214 non-system tables and does not look disposable.',
      '  Use a scratch database, or pass --force if you are sure.',
    ].join('\n');

    expect(refusalSpecimen).toContain('x test-corpus refuses to run: the database has 214 non-system tables');
  });
});
