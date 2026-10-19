import { describe, it, expect } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { PgmoatConfig } from '../../../src/config/schema.js';
import { createServer } from '../../../src/server/create.js';
import { buildInstructions } from '../../../src/server/instructions.js';
import { PGMOAT_VERSION } from '../../../src/version.js';
import type { ToolDeps } from '../../../src/tools/context.js';
import type { SchemaCache } from '../../../src/schema/cache.js';

describe('server factory and instructions (P7.1)', () => {
  const config = PgmoatConfig.parse({
    version: 1,
    server: { name: 'test-pgmoat-server' },
    connection: { url: 'postgresql://localhost:5432/testdb' },
    budgets: {
      max_rows: 150,
      max_payload_bytes: 32_768,
      max_query_ms: 4000,
      max_explain_ms: 2500,
      lock_timeout_ms: 1000,
    },
  });

  const dummyDeps: ToolDeps = {
    config,
    instanceId: 'inst-create-test',
    transport: 'stdio',
    schemaCache: {
      get: () => ({
        builtAt: new Date(),
        serverVersionNum: 180000,
        relations: [],
        byQualifiedName: new Map(),
        hiddenCount: 0,
        policyIndex: {
          tables: new Map(),
          schemas: new Set(),
          unqualified: new Map(),
        },
      }),
    } as unknown as SchemaCache,
  };

  it('builds instructions populated from configuration', () => {
    const text = buildInstructions(config);

    expect(text).toContain('pgmoat gives read-only, governed access');
    expect(text).toContain('Mode: read-only');
    expect(text).toContain('150 rows');
    expect(text).toContain('32 KB');
    expect(text).toContain('4000 ms');
    expect(text).toContain('Start with list_tables, then describe_table, then query');
    expect(text).toContain('untrusted content');
  });

  it('creates McpServer instance with registered tools and instructions', async () => {
    const server = createServer(dummyDeps);
    expect(server).toBeDefined();

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);

    // Verify instructions received in initialize response
    const instructions = client.getInstructions();
    expect(instructions).toBeDefined();
    expect(instructions).toContain('pgmoat gives read-only, governed access');

    const serverVersion = client.getServerVersion();
    expect(serverVersion?.name).toBe('test-pgmoat-server');
    expect(serverVersion?.version).toBe(PGMOAT_VERSION);

    // Verify five tools listed in exact order
    const listResult = await client.listTools();
    expect(listResult.tools.length).toBe(5);
    const names = listResult.tools.map((t) => t.name);
    expect(names).toEqual([
      'describe_table',
      'explain',
      'list_tables',
      'query',
      'sample_table',
    ]);

    await client.close();
    await server.close();
  });
});
