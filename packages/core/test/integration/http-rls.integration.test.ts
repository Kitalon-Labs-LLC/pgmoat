import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {
  generateKeyPair,
  exportJWK,
  SignJWT,
  type KeyLike,
  type JWK,
} from 'jose';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
  startPostgres,
  connectionUrl,
  stopPostgres,
} from './harness/postgres.js';
import { createRuntime, type Runtime } from '../../src/runtime.js';
import { buildZeroConfig } from '../../src/config/defaults.js';
import { startHttp, type HttpServerHandle } from '../../src/server/http.js';
import type { AuditEntry } from '../../src/types.js';

const TENANT_A = 'a0000000-0000-0000-0000-000000000001';
const TENANT_B = 'b0000000-0000-0000-0000-000000000002';

describe('HTTP Principal propagation and token-based RLS (P9.3 - FR-RLS-01, FR-RLS-06)', () => {
  let tmpAuditDir: string;
  let runtime: Runtime;
  let httpHandle: HttpServerHandle;
  let jwksServer: http.Server;
  let jwksPort: number;
  let keyPair: { publicKey: KeyLike; privateKey: KeyLike };
  let publicJwk: JWK;

  const keyId = 'rls-test-key-1';
  const issuer = 'https://auth.acme.test';
  const audience = 'https://pgmoat.acme.test';

  beforeAll(async () => {
    await startPostgres();
    tmpAuditDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgmoat-http-rls-test-'));

    // 1. Generate test RSA key pair and run JWKS server
    keyPair = await generateKeyPair('RS256', { extractable: true });
    publicJwk = await exportJWK(keyPair.publicKey);
    publicJwk.kid = keyId;
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';

    jwksServer = http.createServer((req, res) => {
      if (req.url === '/jwks.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ keys: [publicJwk] }));
        return;
      }
      res.writeHead(404);
      res.end('Not Found');
    });

    await new Promise<void>((resolve) => {
      jwksServer.listen(0, '127.0.0.1', () => {
        const addr = jwksServer.address();
        jwksPort = typeof addr === 'object' && addr !== null ? addr.port : 0;
        resolve();
      });
    });

    // 2. Configure runtime with HTTP transport, OAuth auth, and token.* RLS
    const config = buildZeroConfig(connectionUrl('pgmoat_reader'));
    config.transport = 'http';
    config.http = {
      host: '127.0.0.1',
      port: 0,
      path: '/mcp',
      public_url: audience,
      allowed_hosts: ['127.0.0.1', 'localhost'],
      allowed_origins: [],
      max_body_bytes: 1048576,
    };
    config.auth = {
      mode: 'oauth',
      issuer,
      audience,
      jwks_url: `http://127.0.0.1:${jwksPort}/jwks.json`,
      algorithms: ['RS256'],
      required_scopes: ['pgmoat:read'],
      clock_tolerance_s: 30,
    };
    config.rls = {
      session_variables: {
        'app.tenant_id': 'token.tenant_id',
      },
      required: true,
      protected_tables: ['orders'],
      trust_request_meta: false,
    };
    config.audit = {
      destination: 'file',
      path: tmpAuditDir,
      rotation: 'daily',
      retain_days: 1,
      redact_fields: [],
    };

    runtime = await createRuntime(config, {
      installSignalHandlers: false,
      stdoutGuard: false,
    });

    httpHandle = await startHttp(runtime, { port: 0 });
  }, 60000);

  afterAll(async () => {
    if (httpHandle) {
      await httpHandle.close();
    }
    if (runtime) {
      await runtime.shutdown('test completion');
    }
    if (jwksServer) {
      await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
    }
    try {
      fs.rmSync(tmpAuditDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    await stopPostgres();
  }, 30000);

  async function mintToken(sub: string, tenantId?: string): Promise<string> {
    const claims: Record<string, unknown> = {
      sub,
      scope: 'pgmoat:read',
    };
    if (tenantId !== undefined) {
      claims['tenant_id'] = tenantId;
    }

    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: keyId })
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime('1h')
      .sign(keyPair.privateKey);
  }

  it('runs 200 interleaved concurrent queries across tenant A and B with zero cross-tenant leakage', async () => {
    const tokenA = await mintToken('sub-alice', TENANT_A);
    const tokenB = await mintToken('sub-bob', TENANT_B);

    const TOTAL_QUERIES = 200;
    const CONCURRENCY = 10;
    let crossTenantViolations = 0;
    let queryCountA = 0;
    let queryCountB = 0;

    const tasks = Array.from({ length: TOTAL_QUERIES }, (_, i) => {
      const isTenantA = i % 2 === 0;
      const token = isTenantA ? tokenA : tokenB;
      const expectedTenant = isTenantA ? TENANT_A : TENANT_B;

      return async () => {
        const clientTransport = new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${httpHandle.port}/mcp`),
          {
            requestInit: {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          },
        );

        const client = new Client({ name: 'http-rls-test', version: '1.0.0' });
        await client.connect(clientTransport);

        try {
          const res = await client.callTool({
            name: 'query',
            arguments: { sql: 'SELECT id, tenant_id, amount FROM orders ORDER BY id' },
          });

          expect(res.isError).toBeFalsy();
          const sc = res.structuredContent as {
            rows: { id: number; tenant_id: string; amount: number }[];
          };
          expect(sc).toBeDefined();

          if (isTenantA) {
            queryCountA++;
            if (sc.rows.length !== 2) crossTenantViolations++;
            for (const row of sc.rows) {
              if (row.tenant_id !== expectedTenant) crossTenantViolations++;
            }
          } else {
            queryCountB++;
            if (sc.rows.length !== 1) crossTenantViolations++;
            for (const row of sc.rows) {
              if (row.tenant_id !== expectedTenant) crossTenantViolations++;
            }
          }
        } finally {
          await client.close();
        }
      };
    });

    // Execute concurrently with batching
    for (let i = 0; i < tasks.length; i += CONCURRENCY) {
      const batch = tasks.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map((fn) => fn()));
    }

    expect(queryCountA).toBe(100);
    expect(queryCountB).toBe(100);
    expect(crossTenantViolations).toBe(0);
  }, 60000);

  it('verifies audit logs: principal matches token sub and rls_context records tenant_id', async () => {
    // Flush audit pipeline
    await runtime.audit.flush();

    // Read audit file from tmpAuditDir
    const files = fs.readdirSync(tmpAuditDir).filter((f) => f.endsWith('.ndjson'));
    expect(files.length).toBeGreaterThan(0);

    const logPath = path.join(tmpAuditDir, files[0]!);
    const lines = fs
      .readFileSync(logPath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const entries = lines.map((l) => JSON.parse(l) as AuditEntry);
    const queryEntries = entries.filter((e) => e.tool === 'query' && e.status === 'success');
    expect(queryEntries.length).toBeGreaterThanOrEqual(200);

    const aliceEntries = queryEntries.filter((e) => e.principal === 'sub-alice');
    const bobEntries = queryEntries.filter((e) => e.principal === 'sub-bob');

    expect(aliceEntries.length).toBeGreaterThanOrEqual(100);
    expect(bobEntries.length).toBeGreaterThanOrEqual(100);

    for (const entry of aliceEntries) {
      expect(entry.principal).toBe('sub-alice');
      expect(entry.transport).toBe('http');
      expect(entry.rls_context).toEqual({ 'app.tenant_id': TENANT_A });
    }

    for (const entry of bobEntries) {
      expect(entry.principal).toBe('sub-bob');
      expect(entry.transport).toBe('http');
      expect(entry.rls_context).toEqual({ 'app.tenant_id': TENANT_B });
    }

    // Print sample audit log for report
    const sample = aliceEntries[0];
    process.stderr.write(
      `\n[HTTP Audit Sample]\n${JSON.stringify(sample, null, 2)}\n\n`,
    );
  });

  it('token missing required tenant_id claim yields tool error PGM-405', async () => {
    const tokenNoTenant = await mintToken('sub-charlie'); // missing tenant_id

    const clientTransport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${httpHandle.port}/mcp`),
      {
        requestInit: {
          headers: {
            Authorization: `Bearer ${tokenNoTenant}`,
          },
        },
      },
    );

    const client = new Client({ name: 'http-rls-test-charlie', version: '1.0.0' });
    await client.connect(clientTransport);

    try {
      const res = await client.callTool({
        name: 'query',
        arguments: { sql: 'SELECT id, tenant_id FROM orders' },
      });

      expect(res.isError).toBe(true);
      expect(res._meta?.['com.kitalonlabs.pgmoat/error_code']).toBe('PGM-405');
      const text = (res.content[0] as { text: string }).text;
      expect(text).toContain('PGM-405');
      expect(text).toContain('token.tenant_id');
    } finally {
      await client.close();
    }
  });
});
