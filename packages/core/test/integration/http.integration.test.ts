import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
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

describe('Stateless Streamable HTTP transport integration (P9.1)', () => {
  let tmpAuditDir: string;
  let runtime: Runtime;
  let httpHandle: HttpServerHandle;

  beforeAll(async () => {
    await startPostgres();
    tmpAuditDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgmoat-http-test-'));

    const config = buildZeroConfig(connectionUrl('pgmoat_reader'));
    config.transport = 'http';
    config.http = {
      host: '127.0.0.1',
      port: 0, // dynamically assign
      path: '/mcp',
      allowed_hosts: ['127.0.0.1', 'localhost'],
      allowed_origins: ['http://localhost', 'http://127.0.0.1'],
      max_body_bytes: 4096, // 4 KB for testing limits
    };
    config.auth = {
      mode: 'none',
      algorithms: ['RS256'],
      required_scopes: ['pgmoat:read'],
      clock_tolerance_s: 30,
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
    try {
      fs.rmSync(tmpAuditDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    await stopPostgres();
  }, 30000);

  it('healthz returns 200 ok', async () => {
    const res = await fetch(`http://127.0.0.1:${httpHandle.port}/healthz`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('ok');
  });

  it('readyz returns 200 ok when reader pool connection is acquired', async () => {
    const res = await fetch(`http://127.0.0.1:${httpHandle.port}/readyz`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('ok');
  });

  it('refuses request with bad Host header with 403 (PGM-603)', async () => {
    const status = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: httpHandle.port,
          path: '/mcp',
          method: 'POST',
          headers: {
            host: 'evil.attacker.com',
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            resolve({ status: res.statusCode ?? 0, body: data });
          });
        },
      );
      req.on('error', reject);
      req.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
      req.end();
    });

    expect(status.status).toBe(403);
    expect(status.body).toContain('PGM-603');
  });

  it('refuses request with bad Origin header with 403 (PGM-603)', async () => {
    const res = await fetch(`http://127.0.0.1:${httpHandle.port}/mcp`, {
      method: 'POST',
      headers: {
        host: '127.0.0.1',
        origin: 'http://malicious.domain.xyz',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).toContain('PGM-603');
  });

  it('returns 413 when request body exceeds max_body_bytes', async () => {
    const hugePayload = 'a'.repeat(5000);
    const res = await fetch(`http://127.0.0.1:${httpHandle.port}/mcp`, {
      method: 'POST',
      headers: {
        host: '127.0.0.1',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ payload: hugePayload }),
    });

    expect(res.status).toBe(413);
    const text = await res.text();
    expect(text).toContain('exceeds maximum size');
  });

  it('serves tools/list and tools/call over Streamable HTTP client transport', async () => {
    const clientTransport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${httpHandle.port}/mcp`),
    );
    const client = new Client({ name: 'pgmoat-http-client', version: '1.0.0' });
    await client.connect(clientTransport);

    // List tools
    const toolList = await client.listTools();
    const toolNames = toolList.tools.map((t) => t.name);
    expect(toolNames).toContain('describe_table');
    expect(toolNames).toContain('explain');
    expect(toolNames).toContain('list_tables');
    expect(toolNames).toContain('query');
    expect(toolNames).toContain('sample_table');

    // Query tool call
    const t0 = performance.now();
    const queryResult = await client.callTool({
      name: 'query',
      arguments: { sql: 'SELECT 1 AS num' },
    });
    const latency = performance.now() - t0;
    process.stderr.write(
      `[HTTP Streamable Latency] SELECT 1 round-trip: ${latency.toFixed(2)} ms\n`,
    );

    expect(queryResult.isError).toBeFalsy();
    const content = queryResult.content as Array<{ type: string; text: string }>;
    expect(content.length).toBeGreaterThan(0);
    expect(content[0]?.text).toContain('num');

    const sc = queryResult.structuredContent as {
      columns: { name: string; type: string }[];
      rows: Record<string, unknown>[];
    };
    expect(sc).toBeDefined();
    expect(sc.rows).toEqual([{ num: 1 }]);

    await client.close();
  });
});

