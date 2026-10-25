import { describe, it, expect } from 'vitest';
import { formatStartBanner } from '../src/commands/start.js';
import {
  type PgmoatConfigT,
  startHttp,
  type Runtime,
  PGMOAT_VERSION,
} from '@pgmoat/core';

describe('CLI HTTP start path (P9.4)', () => {
  it('formats HTTP start banner with oauth matching spec/06 section 2.7', () => {
    const config = {
      version: 1,
      server: { name: 'acme-support', description: '' },
      transport: 'http',
      http: {
        host: '0.0.0.0',
        port: 8787,
        path: '/mcp',
        public_url: 'https://pgmoat.acme.internal/mcp',
        allowed_hosts: ['pgmoat.acme.internal'],
        allowed_origins: [],
        max_body_bytes: 1048576,
      },
      auth: {
        mode: 'oauth',
        issuer: 'https://login.acme.com/',
        audience: 'https://pgmoat.acme.internal/mcp',
        jwks_url: 'https://login.acme.com/.well-known/jwks.json',
        algorithms: ['RS256'],
        required_scopes: ['pgmoat:read'],
        clock_tolerance_s: 30,
      },
      connection: { url: 'postgres://localhost/test', schemas: ['public'] },
      mode: 'read-only',
      budgets: { max_rows: 200, max_query_ms: 5000, max_payload_bytes: 65536, max_columns: 50 },
      rls: { session_variables: {}, required: false, protected_tables: [] },
      policy: {},
      tables: {},
      audit: { destination: 'file', path: '/Users/dev/acme/pgmoat-audit/' },
      doctor: { on_start: 'warn' },
      logging: { level: 'info', format: 'ndjson' },
      telemetry: { enabled: false },
    } as unknown as PgmoatConfigT;

    const banner = formatStartBanner(config, '/Users/dev/acme/pgmoat.yaml', {
      snapshot: {
        relations: Array.from({ length: 41 }, (_, i) => ({ qualifiedName: `public.t_${i}` })),
        policyIndex: {
          hiddenRelations: new Set(['public.t_0', 'public.t_1']),
          hiddenColumns: new Map([['public.t_2', new Set(['col1'])]]),
        },
      },
      dbVersion: '17.6',
      currentUser: 'readonly_agent',
      dbHost: 'db.internal',
      dbPort: 5432,
      dbName: 'app',
    });

    expect(banner).toContain(`pgmoat ${PGMOAT_VERSION}  acme-support  read-only`);
    expect(banner).toContain(
      'transport  http  listening on 0.0.0.0:8787/mcp  public url https://pgmoat.acme.internal/mcp',
    );
    expect(banner).toContain(
      'auth       oauth  issuer https://login.acme.com/  scopes pgmoat:read',
    );
    expect(banner).toContain('database   db.internal:5432/app  Postgres 17.6  role readonly_agent');
    expect(banner).toContain('doctor     ok');
    expect(banner).toContain('ready');
  });

  it('formats HTTP start banner with auth none', () => {
    const config = {
      version: 1,
      server: { name: 'local-test', description: '' },
      transport: 'http',
      http: {
        host: '127.0.0.1',
        port: 8787,
        path: '/mcp',
        allowed_hosts: ['127.0.0.1', 'localhost'],
        allowed_origins: [],
        max_body_bytes: 1048576,
      },
      auth: {
        mode: 'none',
        algorithms: ['RS256'],
        required_scopes: ['pgmoat:read'],
        clock_tolerance_s: 30,
      },
      connection: { url: 'postgres://localhost/test', schemas: ['public'] },
      mode: 'read-only',
      budgets: { max_rows: 200, max_query_ms: 5000, max_payload_bytes: 65536 },
      rls: { session_variables: {}, required: false, protected_tables: [] },
      policy: {},
      tables: {},
      audit: { destination: 'file' },
      doctor: { on_start: 'warn' },
      logging: { level: 'info', format: 'ndjson' },
      telemetry: { enabled: false },
    } as unknown as PgmoatConfigT;

    const banner = formatStartBanner(config, '/test/pgmoat.yaml', {
      snapshot: {
        relations: [],
        policyIndex: { hiddenRelations: new Set(), hiddenColumns: new Map() },
      },
      dbVersion: '17.6',
      currentUser: 'local_user',
    });

    expect(banner).toContain('transport  http  listening on 127.0.0.1:8787/mcp');
    expect(banner).toContain('auth       none');
  });

  it('serves tools/list with loopback no-auth config', async () => {
    const mockConfig = {
      version: 1,
      server: { name: 'local-server', description: 'Test' },
      transport: 'http',
      http: {
        host: '127.0.0.1',
        port: 0,
        path: '/mcp',
        allowed_hosts: ['127.0.0.1', 'localhost'],
        allowed_origins: [],
        max_body_bytes: 1048576,
      },
      auth: {
        mode: 'none',
        algorithms: ['RS256'],
        required_scopes: ['pgmoat:read'],
        clock_tolerance_s: 30,
      },
      budgets: { max_rows: 200, max_query_ms: 5000, max_payload_bytes: 65536 },
      rls: { session_variables: {}, required: false, protected_tables: [] },
      audit: { destination: 'file' },
    } as unknown as PgmoatConfigT;

    const mockRuntime = {
      config: mockConfig,
      toolDeps: {
        config: mockConfig,
        audit: { emit: () => {} },
        instanceId: '01JAB000000000000000000000',
        schemaCache: {
          get: () => ({
            builtAt: new Date(),
            serverVersionNum: 170006,
            relations: [],
            byQualifiedName: new Map(),
            hiddenCount: 0,
            policyIndex: {
              allowedSchemas: new Set(['public']),
              tables: new Map(),
              hiddenRelations: new Set(),
              hiddenColumns: new Map(),
            },
          }),
        },
        pools: {
          query: {
            connect: async () => ({
              release: () => {},
            }),
          },
        },
      },
      pools: {
        query: {
          connect: async () => ({
            release: () => {},
          }),
        },
      },
      incrementInFlight: () => {},
      decrementInFlight: () => {},
      logger: {
        error: () => {},
        info: () => {},
      },
    } as unknown as Runtime;

    const handle = await startHttp(mockRuntime, { port: 0 });
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      // Server responds with SSE text/event-stream or application/json
      expect(text).toContain('tools');
      expect(text).toContain('query');
      expect(text).toContain('describe_table');
      expect(text).toContain('list_tables');
      expect(text).toContain('explain');
      expect(text).toContain('sample_table');
    } finally {
      await handle.close();
    }
  });
});
