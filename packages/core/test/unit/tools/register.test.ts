import { describe, it, expect } from 'vitest';
import { PgmoatConfig } from '../../../src/config/schema.js';
import {
  registerTools,
  type ToolRegistrationConfig,
  type ToolRegistrationTarget,
} from '../../../src/tools/register.js';
import { buildToolDescriptions } from '../../../src/tools/descriptions.js';
import type { ToolDeps } from '../../../src/tools/context.js';
import type { SchemaCache } from '../../../src/schema/cache.js';

interface RegisteredToolEntry {
  name: string;
  config: ToolRegistrationConfig;
  handler: (args: unknown, ctx: unknown) => Promise<unknown>;
}

class FakeMcpServer implements ToolRegistrationTarget {
  readonly registered: RegisteredToolEntry[] = [];

  registerTool(
    name: string,
    config: ToolRegistrationConfig,
    handler: (args: unknown, ctx: unknown) => Promise<unknown>,
  ): unknown {
    this.registered.push({ name, config, handler });
    return this;
  }
}

describe('tool registration (P6.8)', () => {
  const config = PgmoatConfig.parse({
    version: 1,
    server: { name: 'test-server' },
    connection: { url: 'postgresql://localhost:5432/db' },
    budgets: {
      max_rows: 200,
      max_payload_bytes: 65_536,
      max_query_ms: 5000,
      max_explain_ms: 3000,
      lock_timeout_ms: 1000,
    },
  });

  const dummyDeps: ToolDeps = {
    config,
    instanceId: 'inst-reg-test',
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

  it('registers exactly five tools in alphabetical order (FR-PROTO-02)', () => {
    const fakeServer = new FakeMcpServer();
    registerTools(fakeServer, dummyDeps);

    expect(fakeServer.registered.length).toBe(5);
    const names = fakeServer.registered.map((r) => r.name);
    expect(names).toEqual([
      'describe_table',
      'explain',
      'list_tables',
      'query',
      'sample_table',
    ]);
  });

  it('sets expected titles matching spec/06 section 5.2', () => {
    const fakeServer = new FakeMcpServer();
    registerTools(fakeServer, dummyDeps);

    const titleMap = Object.fromEntries(
      fakeServer.registered.map((r) => [r.name, r.config.title]),
    );

    expect(titleMap).toEqual({
      describe_table: 'Describe a table',
      explain: 'Show a query plan',
      list_tables: 'List tables',
      query: 'Run a read-only SQL query',
      sample_table: 'Show sample rows',
    });
  });

  it('renders all descriptions under 600 characters with placeholders replaced', () => {
    const descriptions = buildToolDescriptions(config);

    for (const text of Object.values(descriptions)) {
      expect(text.length).toBeLessThan(600);
      expect(text).not.toContain('{max_rows}');
      expect(text).not.toContain('{max_payload_kb}');
      expect(text).not.toContain('{max_query_s}');
      expect(text).not.toContain('{max_explain_ms}');
    }

    expect(descriptions.query).toContain('200 rows');
    expect(descriptions.query).toContain('64 KB');
    expect(descriptions.query).toContain('5 s');
    expect(descriptions.explain).toContain('3000 ms');
  });

  it('sets annotations conforming to spec/04 FR-PROTO-05', () => {
    const fakeServer = new FakeMcpServer();
    registerTools(fakeServer, dummyDeps);

    const byName = new Map(fakeServer.registered.map((r) => [r.name, r.config.annotations]));

    // All tools: readOnlyHint: true, destructiveHint: false, openWorldHint: false
    for (const [name, anno] of byName.entries()) {
      expect(anno.readOnlyHint).toBe(true);
      expect(anno.destructiveHint).toBe(false);
      expect(anno.openWorldHint).toBe(false);

      if (name === 'sample_table') {
        expect(anno.idempotentHint).toBe(false);
      } else {
        expect(anno.idempotentHint).toBe(true);
      }
    }
  });

  it('declares inputSchema and outputSchema for all tools', () => {
    const fakeServer = new FakeMcpServer();
    registerTools(fakeServer, dummyDeps);

    for (const tool of fakeServer.registered) {
      expect(tool.config.inputSchema).toBeDefined();
      expect(tool.config.outputSchema).toBeDefined();
    }
  });
});
