import { describe, it, expect, vi } from 'vitest';
import { runTool, type ToolSuccessResult } from '../../../src/tools/run-tool.js';
import { principalStorage } from '../../../src/tools/context.js';
import { refuse } from '../../../src/errors.js';
import { PgmoatConfig } from '../../../src/config/schema.js';
import type { AuditEntry } from '../../../src/types.js';
import type { ToolDeps } from '../../../src/tools/context.js';

describe('runTool wrapper', () => {
  const config = PgmoatConfig.parse({
    version: 1,
    server: { name: 'test-pgmoat' },
    connection: { url: 'postgresql://localhost/test' },
  });

  function createTestDeps() {
    const emitted: AuditEntry[] = [];
    const deps: ToolDeps = {
      config,
      instanceId: 'inst-test-01',
      audit: {
        emit: (entry: AuditEntry) => {
          emitted.push(entry);
        },
      },
    };
    return { deps, emitted };
  }

  it('handles success: returns structured and text, request_id in _meta, exactly one audit emit', async () => {
    const { deps, emitted } = createTestDeps();

    const mcpCtx = {
      mcpReq: {
        id: 1,
        _meta: {
          traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
          customKey: 'customVal',
        },
        envelope: {
          protocolVersion: '2026-07-28',
          clientInfo: { name: 'claude-desktop', version: '1.2.3' },
        },
      },
    };

    const res = await runTool(
      'query',
      { sql: 'SELECT 1' },
      mcpCtx,
      deps,
      async (rc) => {
        expect(rc.tool).toBe('query');
        expect(rc.params).toEqual({ sql: 'SELECT 1' });
        expect(rc.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
        expect(rc.client.name).toBe('claude-desktop');
        expect(rc.client.version).toBe('1.2.3');
        expect(rc.protocolVersion).toBe('2026-07-28');
        expect(rc.meta['customKey']).toBe('customVal');
        expect(rc.principal.sub).toBe('local');

        rc.sqlExecuted = 'SELECT 1';
        rc.sqlFingerprint = 'fp-select-1';

        return {
          structured: { rows: [{ '?column?': 1 }], rowCount: 1 },
          text: '1 row returned:\n| ?column? |\n| 1 |',
          rowsReturned: 1,
          payloadBytes: 42,
          warnings: ['Notice from DB'],
        };
      },
    );

    // Verify success result structure
    expect(res).not.toHaveProperty('isError');
    expect(res.content[0]?.text).toContain('1 row returned');
    expect((res as ToolSuccessResult).structuredContent).toEqual({
      rows: [{ '?column?': 1 }],
      rowCount: 1,
    });
    expect(res._meta['com.kitalonlabs.pgmoat/request_id']).toBeDefined();

    // Exactly one audit emit
    expect(emitted.length).toBe(1);
    const entry = emitted[0]!;
    expect(entry.status).toBe('success');
    expect(entry.tool).toBe('query');
    expect(entry.trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(entry.client_name).toBe('claude-desktop');
    expect(entry.client_version).toBe('1.2.3');
    expect(entry.rows_returned).toBe(1);
    expect(entry.payload_bytes).toBe(42);
    expect(entry.warnings).toEqual(['Notice from DB']);
    expect(entry.error_code).toBeNull();
    expect(entry.error_message).toBeNull();
  });

  it('handles refusal (PgmoatError): returns refusal text, error code and request_id in _meta, exactly one audit emit', async () => {
    const { deps, emitted } = createTestDeps();

    const res = await runTool(
      'query',
      { sql: 'DELETE FROM users' },
      {},
      deps,
      async () => {
        throw refuse('PGM-201', 'DELETE statements are forbidden in read-only mode');
      },
    );

    expect(res).toHaveProperty('isError', true);
    expect(res.content[0]?.text).toContain('PGM-201');
    expect(res.content[0]?.text).toContain('DELETE statements are forbidden in read-only mode');
    expect(res._meta['com.kitalonlabs.pgmoat/error_code']).toBe('PGM-201');
    expect(res._meta['com.kitalonlabs.pgmoat/request_id']).toBeDefined();

    // Exactly one audit emit
    expect(emitted.length).toBe(1);
    const entry = emitted[0]!;
    expect(entry.status).toBe('refused');
    expect(entry.error_code).toBe('PGM-201');
    expect(entry.error_message).toContain('DELETE statements are forbidden');
  });

  it('handles unknown error: maps to PGM-506, does not leak stack to client, logs stack to stderr', async () => {
    const { deps, emitted } = createTestDeps();

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const secretDbPath = '/var/lib/super_secret_credentials.sqlite3';
    const errorStack = `Error: Fatal memory fault at ${secretDbPath}\n    at querySecret (/internal/secret.ts:42:15)`;

    const unknownErr = new Error(`Fatal memory fault at ${secretDbPath}`);
    unknownErr.stack = errorStack;

    const res = await runTool(
      'query',
      { sql: 'SELECT 1' },
      {},
      deps,
      async () => {
        throw unknownErr;
      },
    );

    stderrSpy.mockRestore();

    // Output to client MUST NOT contain internal paths or stack trace
    expect(res).toHaveProperty('isError', true);
    expect(res.content[0]?.text).toContain('PGM-506');
    expect(res.content[0]?.text).not.toContain(secretDbPath);
    expect(res.content[0]?.text).not.toContain('/internal/secret.ts');
    expect(res._meta['com.kitalonlabs.pgmoat/error_code']).toBe('PGM-506');
    expect(res._meta['com.kitalonlabs.pgmoat/request_id']).toBeDefined();

    // Audit log recorded
    expect(emitted.length).toBe(1);
    const entry = emitted[0]!;
    expect(entry.status).toBe('error');
    expect(entry.error_code).toBe('PGM-506');
  });

  it('handles cancellation: status canceled and exactly one audit emit', async () => {
    const { deps, emitted } = createTestDeps();

    const abortController = new AbortController();
    abortController.abort();

    const res = await runTool(
      'query',
      { sql: 'SELECT pg_sleep(10)' },
      { mcpReq: { signal: abortController.signal } },
      deps,
      async () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      },
    );

    expect(res).toHaveProperty('isError', true);
    expect(res._meta['com.kitalonlabs.pgmoat/request_id']).toBeDefined();

    expect(emitted.length).toBe(1);
    const entry = emitted[0]!;
    expect(entry.status).toBe('canceled');
  });

  it('reads principal from AsyncLocalStorage when available', async () => {
    const { deps, emitted } = createTestDeps();

    const customPrincipal = {
      kind: 'token' as const,
      sub: 'tenant-user-42',
      scopes: new Set(['read']),
      claims: { tenant_id: 'org-123' },
    };

    await principalStorage.run(customPrincipal, async () => {
      await runTool('list_tables', {}, {}, deps, async (rc) => {
        expect(rc.principal.kind).toBe('token');
        expect(rc.principal.sub).toBe('tenant-user-42');
        return {
          structured: { tables: [] },
          text: 'No tables',
        };
      });
    });

    expect(emitted.length).toBe(1);
    expect(emitted[0]?.principal).toBe('tenant-user-42');
  });
});
