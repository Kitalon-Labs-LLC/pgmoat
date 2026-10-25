import { refuse } from '../errors.js';
import { resolveRelationFromIndex } from '../safety/policy.js';
import type { SchemaSnapshot } from '../types.js';
import {
  DescribeTableResultSchema,
  type DescribeTableResultT,
} from '../output/schemas.js';
import { renderDescribe } from '../output/text.js';
import { runTool, type ToolOutcome, type ToolResult } from './run-tool.js';
import type { ToolDeps } from './context.js';

export interface DescribeTableInput {
  readonly table: string;
}

/**
 * Core discovery logic for describe_table: returns structured and rendered text
 * with hidden relations and columns excluded. Reuses the policy layer's
 * name resolution logic so that hidden and unknown tables produce the identical refusal.
 */
export function executeDescribeTable(
  input: DescribeTableInput,
  snapshot: SchemaSnapshot,
  requestId: string,
): ToolOutcome {
  if (!input.table || typeof input.table !== 'string') {
    throw refuse(
      'PGM-207',
      'Table not available. Use list_tables to see the tables you can query.',
    );
  }

  const qualifiedName = resolveRelationFromIndex(
    input.table,
    snapshot.policyIndex,
  );
  if (!qualifiedName) {
    throw refuse(
      'PGM-207',
      'Table not available. Use list_tables to see the tables you can query.',
    );
  }

  const relation = snapshot.byQualifiedName.get(qualifiedName);
  if (!relation) {
    throw refuse(
      'PGM-207',
      'Table not available. Use list_tables to see the tables you can query.',
    );
  }

  const structured: DescribeTableResultT = {
    table: {
      schema: relation.schema,
      name: relation.name,
      qualified_name: relation.qualifiedName,
      kind: relation.kind,
      description: relation.description,
      row_estimate: relation.rowEstimate < 0 ? null : relation.rowEstimate,
      columns: relation.columns.map((c) => ({
        name: c.name,
        type: c.type,
        not_null: c.notNull,
        default: c.default,
        description: c.description,
        sensitive: c.sensitive,
        untrusted: c.untrusted,
      })),
      hidden_column_count: relation.hiddenColumnCount,
      primary_key: relation.primaryKey ? [...relation.primaryKey] : null,
      unique_keys: relation.uniqueKeys.map((uk) => [...uk]),
      foreign_keys: relation.foreignKeys.map((fk) => ({
        name: fk.name,
        columns: [...fk.columns],
        references: {
          relation: fk.references.relation,
          columns: [...fk.references.columns],
        },
        on_delete: fk.onDelete,
      })),
      referenced_by: relation.referencedBy.map((r) => ({
        relation: r.relation,
        columns: [...r.columns],
      })),
      indexes: relation.indexes.map((idx) => ({
        name: idx.name,
        columns: [...idx.columns],
        unique: idx.unique,
        primary: idx.primary,
        definition: idx.definition,
      })),
      relationships: [...relation.relationships],
      rls: {
        enabled: relation.rls.enabled,
        forced: relation.rls.forced,
      },
    },
    warnings: [],
    request_id: requestId,
  };

  // Validate against Zod schema
  DescribeTableResultSchema.parse(structured);

  const text = renderDescribe(structured);
  return { structured, text };
}

/**
 * MCP tool handler for describe_table.
 */
export async function describeTableTool(
  args: unknown,
  ctx: unknown,
  deps: ToolDeps,
): Promise<ToolResult> {
  const snapshot =
    deps.schemaCache?.get() ?? (deps as unknown as { snapshot?: SchemaSnapshot }).snapshot;
  if (!snapshot) {
    throw new Error('No schema snapshot available in dependencies');
  }

  return runTool('describe_table', args, ctx, deps, async (rc) => {
    const input = (args ?? {}) as DescribeTableInput;
    return executeDescribeTable(input, snapshot, rc.requestId);
  });
}
