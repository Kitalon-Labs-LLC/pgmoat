import { deparse } from 'pgsql-deparser';
import type { ParseResult, Node } from '@pgsql/types';
import { refuse, safetyError } from '../errors.js';
import { resolveRls } from '../rls/resolve.js';
import { resolveRelationFromIndex } from '../safety/policy.js';
import { runSafety } from '../safety/pipeline.js';
import { executeRead, type ExecuteBudgets } from '../postgres/execute.js';
import { applyBudgets, type ApplyBudgetsExtras } from '../budgets/index.js';
import { renderRows } from '../output/text.js';
import type { SchemaSnapshot, RequestContext, RelationInfo, RowsResult } from '../types.js';
import type { Pools } from '../postgres/pool.js';
import { runTool, type ToolOutcome, type ToolResult } from './run-tool.js';
import type { ToolDeps } from './context.js';

export interface SampleTableInput {
  readonly table: string;
  readonly limit?: number;
}

/**
 * Builds a SelectStmt AST for sampling a table:
 * - Explicit ResTarget per visible column
 * - RangeVar with schema and relation name
 * - RangeTableSample SYSTEM(p) when rowEstimate > 1,000,000
 * - ORDER BY random()
 * - LIMIT n (1..5)
 */
function buildSampleAst(rel: RelationInfo, limit: number): ParseResult {
  const targetList = rel.columns.map((col) => ({
    ResTarget: {
      val: {
        ColumnRef: {
          fields: [
            {
              String: {
                sval: col.name,
              },
            },
          ],
        },
      },
    },
  }));

  const rangeVar = {
    RangeVar: {
      schemaname: rel.schema,
      relname: rel.name,
      inh: true,
      relpersistence: 'p',
    },
  };

  let fromClauseItem: Node;
  if (rel.rowEstimate > 1_000_000) {
    // p = clamp(100 / rowEstimate * 100 * 2, 0.0001, 10)
    const rawP = (100 / rel.rowEstimate) * 100 * 2;
    const clampedP = Math.min(Math.max(rawP, 0.0001), 10);
    const pStr = clampedP.toFixed(4);
    fromClauseItem = {
      RangeTableSample: {
        relation: rangeVar,
        method: [
          {
            String: {
              sval: 'system',
            },
          },
        ],
        args: [
          {
            A_Const: {
              fval: {
                fval: pStr,
              },
            },
          },
        ],
      },
    } as unknown as Node;
  } else {
    fromClauseItem = rangeVar as unknown as Node;
  }

  const selectStmt = {
    SelectStmt: {
      targetList,
      fromClause: [fromClauseItem],
      sortClause: [
        {
          SortBy: {
            node: {
              FuncCall: {
                funcname: [
                  {
                    String: {
                      sval: 'random',
                    },
                  },
                ],
                funcformat: 'COERCE_EXPLICIT_CALL',
              },
            },
            sortby_dir: 'SORTBY_DEFAULT',
            sortby_nulls: 'SORTBY_NULLS_DEFAULT',
          },
        },
      ],
      limitCount: {
        A_Const: {
          ival: {
            ival: limit,
          },
        },
      },
      limitOption: 'LIMIT_OPTION_COUNT',
      op: 'SETOP_NONE',
    },
  };

  return {
    version: 180000,
    stmts: [
      {
        stmt: selectStmt as unknown as Node,
      },
    ],
  };
}

/**
 * Runs governed sample_table execution:
 * 1. Resolve table from policy index (refuse hidden or unknown with PGM-207)
 * 2. Build sample statement as AST with visible columns only
 * 3. Deparse and execute through safety pipeline & executeRead
 * 4. Mask sensitive columns (medium or high) as "[masked]" and mark masked: true
 * 5. Return framed RowsResult text or "Table is empty."
 */
export async function executeSampleTable(
  input: SampleTableInput,
  rc: RequestContext,
  snapshot: SchemaSnapshot,
  deps: ToolDeps,
): Promise<ToolOutcome> {
  if (!input.table || typeof input.table !== 'string' || input.table.trim().length === 0) {
    throw refuse(
      'PGM-207',
      'Table not available. Use list_tables to see the tables you can query.',
    );
  }

  const qualifiedName = resolveRelationFromIndex(
    input.table.trim(),
    snapshot.policyIndex,
  );
  if (!qualifiedName) {
    throw refuse(
      'PGM-207',
      'Table not available. Use list_tables to see the tables you can query.',
    );
  }

  // Find visible relation info from snapshot
  const rel = snapshot.byQualifiedName.get(qualifiedName);
  if (!rel) {
    throw refuse(
      'PGM-207',
      'Table not available. Use list_tables to see the tables you can query.',
    );
  }

  if (rel.columns.length === 0) {
    throw refuse(
      'PGM-207',
      'Table not available. Use list_tables to see the tables you can query.',
    );
  }

  // Limit clamped between 1 and 5 (default 5)
  const rawLimit = input.limit ?? 5;
  const limit = Math.min(Math.max(Math.floor(rawLimit), 1), 5);

  // 1. Resolve RLS before parsing / safety checks
  const resolvedRls = resolveRls({
    rls: deps.config.rls,
    transport: rc.transport,
    principal: rc.principal,
    meta: rc.meta,
  });
  rc.rls = resolvedRls;

  // 2. Build AST and deparse
  const ast = buildSampleAst(rel, limit);
  const sampleSql = await deparse(ast);

  // 3. Run Safety pipeline on generated query (defense in depth)
  const safetyResult = await runSafety(sampleSql, {
    policyIndex: snapshot.policyIndex,
    policy: deps.config.policy,
    budgets: deps.config.budgets,
    mode: 'query',
  });

  if (!safetyResult.allowed) {
    throw safetyError(safetyResult);
  }

  rc.sqlExecuted = safetyResult.sql;
  rc.sqlFingerprint = safetyResult.fingerprint;

  // 4. Execution
  const pools: Pools =
    deps.pools ??
    (deps.pool && typeof deps.pool === 'object' && 'query' in deps.pool
      ? (deps.pool as unknown as Pools)
      : {
          query: deps.pool as unknown as Pools['query'],
          control: {
            cancelBackend: async () => false,
            end: async () => {},
          } as unknown as Pools['control'],
          end: async () => {},
        });

  if (!pools || !pools.query) {
    throw new Error('Database pool is not available in dependencies');
  }

  const execBudgets: ExecuteBudgets = {
    max_rows: limit,
    max_query_ms: deps.config.budgets.max_query_ms,
    lock_timeout_ms: deps.config.budgets.lock_timeout_ms,
  };

  const execResult = await executeRead(
    pools,
    safetyResult.sql,
    resolvedRls,
    execBudgets,
    rc.signal,
    { sqlFingerprint: safetyResult.fingerprint },
  );

  // 5. Apply budgets
  const untrustedCols = new Set<string>();
  const sensitiveCols = new Set<string>();
  for (const col of rel.columns) {
    if (col.untrusted) untrustedCols.add(col.name);
    if (col.sensitive) sensitiveCols.add(col.name);
  }

  const extras: ApplyBudgetsExtras = {
    requestId: rc.requestId,
    untrustedColumns: untrustedCols,
    sensitiveColumns: sensitiveCols,
  };

  const budgetOutcome = applyBudgets(execResult, deps.config.budgets, extras);
  if ('refused' in budgetOutcome) {
    throw budgetOutcome.refused;
  }

  const rowsResult = budgetOutcome.result;

  // 6. Mask columns with sensitive: medium | high
  const sensitiveMediumOrHigh = new Set<string>();
  for (const col of rel.columns) {
    if (col.sensitive === 'medium' || col.sensitive === 'high') {
      sensitiveMediumOrHigh.add(col.name);
    }
  }

  const maskedColumns = rowsResult.columns.map((c) => {
    if (sensitiveMediumOrHigh.has(c.name)) {
      return { ...c, masked: true };
    }
    return c;
  });

  const maskedRows = rowsResult.rows.map((r) => {
    const copy = { ...r };
    for (const colName of sensitiveMediumOrHigh) {
      // eslint-disable-next-line security/detect-object-injection
      if (colName in copy && copy[colName] !== null) {
        // eslint-disable-next-line security/detect-object-injection
        copy[colName] = '[masked]';
      }
    }
    return copy;
  });

  const finalRowsResult: RowsResult = {
    ...rowsResult,
    columns: maskedColumns,
    rows: maskedRows,
  };

  // 7. Render text
  const text =
    finalRowsResult.row_count === 0
      ? ['Table \'', rel.name, '\' is empty.'].join('')
      : renderRows(finalRowsResult, execResult.durationMs);

  const payloadBytes = Buffer.byteLength(text, 'utf8');
  rc.rowsReturned = finalRowsResult.row_count;
  rc.payloadBytes = payloadBytes;

  return {
    structured: finalRowsResult,
    text,
    rowsReturned: finalRowsResult.row_count,
    payloadBytes,
    warnings: [...rc.warnings],
  };
}

/**
 * MCP tool handler for sample_table.
 */
export async function sampleTableTool(
  args: unknown,
  ctx: unknown,
  deps: ToolDeps,
): Promise<ToolResult> {
  const snapshot =
    deps.schemaCache?.get() ?? (deps as unknown as { snapshot?: SchemaSnapshot }).snapshot;
  if (!snapshot) {
    throw new Error('No schema snapshot available in dependencies');
  }

  return runTool('sample_table', args, ctx, deps, async (rc) => {
    const input = (args ?? {}) as SampleTableInput;
    return executeSampleTable(input, rc, snapshot, deps);
  });
}
