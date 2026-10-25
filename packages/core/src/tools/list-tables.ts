import { refuse } from '../errors.js';
import type { SchemaSnapshot } from '../types.js';
import {
  ListTablesResultSchema,
  type ListTablesResultT,
} from '../output/schemas.js';
import { renderListTables } from '../output/text.js';
import { runTool, type ToolOutcome, type ToolResult } from './run-tool.js';
import type { ToolDeps } from './context.js';

export interface ListTablesInput {
  readonly schema?: string;
}

/**
 * Core discovery logic for list_tables: returns structured and rendered text
 * with hidden relations excluded and row counts formatted.
 */
export function executeListTables(
  input: ListTablesInput,
  snapshot: SchemaSnapshot,
  requestId: string,
): ToolOutcome {
  if (input.schema && !snapshot.policyIndex.exposedSchemas.includes(input.schema)) {
    throw refuse(
      'PGM-207',
      'Table not available. Use list_tables to see the tables you can query.',
    );
  }

  const filtered = snapshot.relations.filter(
    (r) => !input.schema || r.schema === input.schema,
  );

  // Sorted by qualified name ascending
  const sorted = [...filtered].sort((a, b) =>
    a.qualifiedName.localeCompare(b.qualifiedName),
  );

  const structured: ListTablesResultT = {
    relations: sorted.map((r) => ({
      schema: r.schema,
      name: r.name,
      qualified_name: r.qualifiedName,
      kind: r.kind,
      description: r.description,
      row_estimate: r.rowEstimate < 0 ? null : r.rowEstimate,
    })),
    hidden_count: snapshot.hiddenCount,
    warnings: [],
    request_id: requestId,
  };

  // Validate against Zod schema
  ListTablesResultSchema.parse(structured);

  const text = renderListTables(structured);
  return { structured, text };
}

/**
 * MCP tool handler for list_tables.
 */
export async function listTablesTool(
  args: unknown,
  ctx: unknown,
  deps: ToolDeps,
): Promise<ToolResult> {
  const snapshot =
    deps.schemaCache?.get() ?? (deps as unknown as { snapshot?: SchemaSnapshot }).snapshot;
  if (!snapshot) {
    throw new Error('No schema snapshot available in dependencies');
  }

  return runTool('list_tables', args, ctx, deps, async (rc) => {
    const input = (args ?? {}) as ListTablesInput;
    return executeListTables(input, snapshot, rc.requestId);
  });
}
