import * as z from 'zod';
import { buildToolDescriptions } from './descriptions.js';
import { describeTableTool } from './describe-table.js';
import { explainTool } from './explain.js';
import { listTablesTool } from './list-tables.js';
import { queryTool } from './query.js';
import { sampleTableTool } from './sample-table.js';
import {
  DescribeTableResultSchema,
  ExplainResultSchema,
  ListTablesResultSchema,
  RowsResultSchema,
} from '../output/schemas.js';
import type { McpServer, CallToolResult } from '@modelcontextprotocol/server';
import type { ToolDeps } from './context.js';

export interface ToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

export interface ToolRegistrationConfig {
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, z.ZodTypeAny>;
  readonly outputSchema: z.ZodTypeAny;
  readonly annotations: ToolAnnotations;
}

export interface ToolRegistrationTarget {
  registerTool: McpServer['registerTool'];
}

/**
 * Registers the five core tools in fixed alphabetical order:
 * 1. describe_table
 * 2. explain
 * 3. list_tables
 * 4. query
 * 5. sample_table
 *
 * Spec reference: spec/04 FR-PROTO-02..05; spec/06 section 5.2
 */
export function registerTools(
  server: ToolRegistrationTarget,
  deps: ToolDeps,
): void {
  const descriptions = buildToolDescriptions(deps.config);
  const maxSqlChars = deps.config.budgets.max_sql_chars;

  // 1. describe_table
  server.registerTool(
    'describe_table',
    {
      title: 'Describe a table',
      description: descriptions.describe_table,
      inputSchema: {
        table: z
          .string()
          .min(1)
          .max(200)
          .describe('Table or view name, preferably schema-qualified (e.g. public.users)'),
      },
      outputSchema: DescribeTableResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args: unknown, ctx: unknown) =>
      (await describeTableTool(args, ctx, deps)) as unknown as CallToolResult,
  );

  // 2. explain
  server.registerTool(
    'explain',
    {
      title: 'Show a query plan',
      description: descriptions.explain,
      inputSchema: {
        sql: z
          .string()
          .min(1)
          .max(maxSqlChars)
          .describe('Single read-only SELECT statement to explain without running (no ANALYZE)'),
      },
      outputSchema: ExplainResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args: unknown, ctx: unknown) =>
      (await explainTool(args, ctx, deps)) as unknown as CallToolResult,
  );

  // 3. list_tables
  server.registerTool(
    'list_tables',
    {
      title: 'List tables',
      description: descriptions.list_tables,
      inputSchema: {
        schema: z
          .string()
          .optional()
          .describe('Optional schema name to filter tables (defaults to configured schemas)'),
      },
      outputSchema: ListTablesResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args: unknown, ctx: unknown) =>
      (await listTablesTool(args, ctx, deps)) as unknown as CallToolResult,
  );

  // 4. query
  server.registerTool(
    'query',
    {
      title: 'Run a read-only SQL query',
      description: descriptions.query,
      inputSchema: {
        sql: z
          .string()
          .min(1)
          .max(maxSqlChars)
          .describe('Single read-only SQL statement (SELECT, SHOW, or EXPLAIN without ANALYZE)'),
      },
      outputSchema: RowsResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args: unknown, ctx: unknown) =>
      (await queryTool(args, ctx, deps)) as unknown as CallToolResult,
  );

  // 5. sample_table
  server.registerTool(
    'sample_table',
    {
      title: 'Show sample rows',
      description: descriptions.sample_table,
      inputSchema: {
        table: z
          .string()
          .min(1)
          .max(200)
          .describe('Table or view name to sample from'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe('Number of random rows to return (1 to 5, default 5)'),
      },
      outputSchema: RowsResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false, // Random sampling is non-idempotent per FR-PROTO-05
        openWorldHint: false,
      },
    },
    async (args: unknown, ctx: unknown) =>
      (await sampleTableTool(args, ctx, deps)) as unknown as CallToolResult,
  );
}
