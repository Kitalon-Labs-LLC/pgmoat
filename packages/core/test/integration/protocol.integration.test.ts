import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import {
  startPostgres,
  connectionUrl,
  stopPostgres,
} from './harness/postgres.js';
import {
  createModernClient,
  spawnServer,
  LegacyStdioClient,
  type SpawnedServerProcess,
} from './harness/mcp-client.js';

describe('Protocol compatibility, concurrency & cancellation (P7.4, FR-PROTO-01..12)', () => {
  let adminClient: pg.Client;
  let dbUrl: string;

  beforeAll(async () => {
    await startPostgres();
    dbUrl = connectionUrl('pgmoat_reader');
    adminClient = new pg.Client({ connectionString: connectionUrl('postgres') });
    await adminClient.connect();
  }, 60000);

  afterAll(async () => {
    await adminClient?.end();
    await stopPostgres();
  });

  it('modern client: lists tools twice with byte-identical alphabetical order and annotations (FR-PROTO-02..05)', async () => {
    const { client, transport } = createModernClient(dbUrl);
    await client.connect(transport);

    try {
      const list1 = await client.listTools();
      const list2 = await client.listTools();

      expect(list1).toEqual(list2);

      const toolNames = list1.tools.map((t) => t.name);
      expect(toolNames).toEqual([
        'describe_table',
        'explain',
        'list_tables',
        'query',
        'sample_table',
      ]);

      for (const tool of list1.tools) {
        expect(tool.title).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.annotations).toBeDefined();
        expect(tool.annotations?.readOnlyHint).toBe(true);
        expect(tool.annotations?.destructiveHint).toBe(false);
        expect(tool.annotations?.openWorldHint).toBe(false);

        if (tool.name === 'sample_table') {
          expect(tool.annotations?.idempotentHint).toBe(false);
        } else {
          expect(tool.annotations?.idempotentHint).toBe(true);
        }
      }
    } finally {
      await client.close();
    }
  });

  it('modern client: executes read query successfully with structured and text output', async () => {
    const { client, transport } = createModernClient(dbUrl);
    await client.connect(transport);

    try {
      const result = await client.callTool({
        name: 'query',
        arguments: { sql: "SELECT 1 AS num, 'hello' AS greeting" },
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toContain('num');
      expect(result.content[0]?.text).toContain('greeting');

      const sc = result.structuredContent as {
        columns: { name: string; type: string }[];
        rows: Record<string, unknown>[];
      };
      expect(sc).toBeDefined();
      expect(sc.columns.map((c) => c.name)).toEqual(['num', 'greeting']);
      expect(sc.rows).toEqual([{ num: 1, greeting: 'hello' }]);
    } finally {
      await client.close();
    }
  });

  it('modern client: refusal returns isError true with error_code and request_id metadata (FR-PROTO-10)', async () => {
    const { client, transport } = createModernClient(dbUrl);
    await client.connect(transport);

    try {
      // Non-read query triggers safety refusal PGM-201
      const result = await client.callTool({
        name: 'query',
        arguments: { sql: 'DELETE FROM orders WHERE id = 1' },
      });

      expect(result.isError).toBe(true);
      expect(result._meta).toBeDefined();
      expect(result._meta?.['com.kitalonlabs.pgmoat/error_code']).toBe('PGM-201');
      expect(result._meta?.['com.kitalonlabs.pgmoat/request_id']).toHaveLength(26);
      expect(result.content[0]?.text).toContain('PGM-201');
    } finally {
      await client.close();
    }
  });

  it('handles 100 concurrent queries with distinct request IDs (FR-PROTO-07)', async () => {
    const { client, transport } = createModernClient(dbUrl);
    await client.connect(transport);

    try {
      const count = 100;
      const promises = Array.from({ length: count }, (_, i) =>
        client.callTool({
          name: 'query',
          arguments: { sql: `SELECT ${i} AS idx` },
        }),
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(count);

      const requestIds = new Set<string>();
      for (const res of results) {
        expect(res.isError).toBeFalsy();
        const reqId = res._meta?.['com.kitalonlabs.pgmoat/request_id'] as string;
        expect(reqId).toHaveLength(26);
        requestIds.add(reqId);
      }

      // All 100 request IDs must be unique
      expect(requestIds.size).toBe(count);
    } finally {
      await client.close();
    }
  });

  it('cancels long query and confirms backend disappears within 2s (FR-PROTO-08)', async () => {
    const { client, transport } = createModernClient(dbUrl);
    await client.connect(transport);

    try {
      const abortController = new AbortController();

      // Slow Cartesian product query that runs for several seconds
      const slowSql =
        'SELECT count(*) FROM (SELECT generate_series(1, 10000000) AS a) x CROSS JOIN (SELECT generate_series(1, 10000000) AS b) y';

      const callPromise = client.callTool(
        {
          name: 'query',
          arguments: { sql: slowSql },
        },
        undefined,
        { signal: abortController.signal },
      );

      // Wait 150ms for query to be running in Postgres backend
      await new Promise((r) => setTimeout(r, 150));

      // Trigger client cancellation
      abortController.abort();

      // Expect call to reject or return canceled error
      try {
        const res = await callPromise;
        expect(res.isError).toBe(true);
      } catch (err) {
        expect(err).toBeDefined();
      }

      // Confirm backend in Postgres disappears within 2 seconds
      const deadline = Date.now() + 2000;
      let backendRunning = true;
      while (Date.now() < deadline) {
        const check = await adminClient.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM pg_stat_activity
           WHERE query LIKE '%generate_series%'
             AND query LIKE '%CROSS JOIN%'
             AND pid <> pg_backend_pid()`,
        );
        if (Number(check.rows[0]?.count) === 0) {
          backendRunning = false;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }

      expect(backendRunning).toBe(false);
    } finally {
      await client.close();
    }
  });

  it('legacy-era client (protocol 2024-11-05 / 2025-11-25) connects, lists tools, calls query, and preserves stdout cleanliness (FR-PROTO-01, FR-PROTO-11)', async () => {
    let server: SpawnedServerProcess | null = null;
    try {
      server = spawnServer(dbUrl);
      const legacyClient = new LegacyStdioClient(server.process);

      // 1. Initialize with legacy protocol version
      const initResult = (await legacyClient.initialize('2024-11-05')) as {
        protocolVersion: string;
        serverInfo: { name: string; version: string };
        capabilities: Record<string, unknown>;
      };

      expect(initResult.serverInfo.name).toBe('pgmoat');
      expect(initResult.protocolVersion).toBe('2024-11-05');
      process.stderr.write(`[Negotiated Era] Legacy handshake negotiated version: ${initResult.protocolVersion}\n`);

      // 2. List tools
      const listResult = (await legacyClient.send('tools/list')) as {
        tools: { name: string }[];
      };
      expect(listResult.tools.map((t) => t.name)).toEqual([
        'describe_table',
        'explain',
        'list_tables',
        'query',
        'sample_table',
      ]);

      // 3. Call tool
      const callResult = (await legacyClient.send('tools/call', {
        name: 'query',
        arguments: { sql: 'SELECT 999 AS legacy_test' },
      })) as {
        content: [{ type: string; text: string }];
        isError?: boolean;
      };

      expect(callResult.isError).toBeFalsy();
      expect(callResult.content[0]?.text).toContain('999');

      // 4. Verify stdout cleanliness (FR-PROTO-11)
      // Every single line emitted to stdout MUST parse as valid JSON-RPC
      expect(legacyClient.rawStdoutLines.length).toBeGreaterThan(0);
      for (const line of legacyClient.rawStdoutLines) {
        let parsed: unknown;
        expect(() => {
          parsed = JSON.parse(line);
        }).not.toThrow();
        expect(parsed).toBeTypeOf('object');
        expect(parsed).not.toBeNull();
        expect((parsed as { jsonrpc: string }).jsonrpc).toBe('2.0');
      }
    } finally {
      await server?.stop();
    }
  });
});
