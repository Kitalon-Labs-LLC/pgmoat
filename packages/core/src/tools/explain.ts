import { deparse } from 'pgsql-deparser';
import { refuse, fail, isPgmoatError, safetyError } from '../errors.js';
import { resolveRls } from '../rls/resolve.js';
import { parseSql } from '../safety/parse.js';
import { runSafety } from '../safety/pipeline.js';
import { executeRead, type ExecuteBudgets } from '../postgres/execute.js';
import { renderExplain } from '../output/text.js';
import type { SchemaSnapshot, RequestContext } from '../types.js';
import type { ParseResult } from '@pgsql/types';
import type { Pools } from '../postgres/pool.js';
import type { ExplainResultT } from '../output/schemas.js';
import { runTool, type ToolOutcome, type ToolResult } from './run-tool.js';
import type { ToolDeps } from './context.js';

export interface ExplainInput {
  readonly sql: string;
}

/**
 * Runs governed plan-only EXPLAIN lifecycle:
 * 1. Resolve RLS session variables
 * 2. Run AST safety pipeline on inner SQL (mode: 'explain', no LIMIT injection)
 * 3. Construct ExplainStmt AST with (FORMAT JSON, COSTS TRUE) and no ANALYZE
 * 4. Execute inside BEGIN READ ONLY with statement_timeout = max_explain_ms
 * 5. Extract top node, total cost, plan rows and plan tree
 * 6. Format structured output and indented text
 */
export async function executeExplain(
  input: ExplainInput,
  rc: RequestContext,
  snapshot: SchemaSnapshot,
  deps: ToolDeps,
): Promise<ToolOutcome> {
  if (!input.sql || typeof input.sql !== 'string' || input.sql.trim().length === 0) {
    throw refuse('PGM-206', 'SQL is empty');
  }

  // 1. Resolve RLS before parsing / safety checks
  const resolvedRls = resolveRls({
    rls: deps.config.rls,
    transport: rc.transport,
    principal: rc.principal,
    meta: rc.meta,
  });
  rc.rls = resolvedRls;

  // 2. Run Safety pipeline on inner SQL in 'explain' mode
  const safetyResult = await runSafety(input.sql, {
    policyIndex: snapshot.policyIndex,
    policy: deps.config.policy,
    budgets: deps.config.budgets,
    mode: 'explain',
  });

  if (!safetyResult.allowed) {
    throw safetyError(safetyResult);
  }

  // 3. Construct EXPLAIN statement AST wrapping the parsed statement
  const parseRes = await parseSql(input.sql, {
    maxSqlChars: deps.config.budgets.max_sql_chars,
  });
  const innerStmt = parseRes.tree.stmts?.[0]?.stmt;
  if (!innerStmt) {
    throw refuse('PGM-206', 'SQL is empty');
  }

  const explainTree: ParseResult = {
    version: parseRes.grammarVersion ?? 180000,
    stmts: [
      {
        stmt: {
          ExplainStmt: {
            query: innerStmt,
            options: [
              {
                DefElem: {
                  defname: 'format',
                  arg: {
                    String: {
                      sval: 'json',
                    },
                  },
                  defaction: 'DEFELEM_UNSPEC',
                },
              },
              {
                DefElem: {
                  defname: 'costs',
                  arg: {
                    String: {
                      sval: 'true',
                    },
                  },
                  defaction: 'DEFELEM_UNSPEC',
                },
              },
            ],
          },
        },
      },
    ],
  };

  const explainSql = await deparse(explainTree);

  rc.sqlExecuted = explainSql;
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
    max_rows: 100,
    max_query_ms: deps.config.budgets.max_explain_ms,
    lock_timeout_ms: deps.config.budgets.lock_timeout_ms,
  };

  let execResult;
  try {
    execResult = await executeRead(
      pools,
      explainSql,
      resolvedRls,
      execBudgets,
      rc.signal,
      { sqlFingerprint: safetyResult.fingerprint },
    );
  } catch (err: unknown) {
    if (isPgmoatError(err) && err.code === 'PGM-303') {
      throw fail('PGM-308', 'EXPLAIN query exceeded max_explain_ms and was canceled');
    }
    throw err;
  }

  // 5. Extract plan JSON
  let rawPlan: unknown = undefined;
  if (execResult.rows.length > 0) {
    const firstRow = execResult.rows[0];
    if (firstRow) {
      const keys = Object.keys(firstRow);
      const planKey = keys.find((k) => k.toLowerCase() === 'query plan') ?? keys[0];
      if (planKey) {
        // eslint-disable-next-line security/detect-object-injection
        rawPlan = firstRow[planKey];
      }
    }
  }

  if (typeof rawPlan === 'string') {
    try {
      rawPlan = JSON.parse(rawPlan);
    } catch {
      // Keep as string if not valid JSON
    }
  }

  const planArr = Array.isArray(rawPlan) ? rawPlan : [rawPlan];
  const firstItem = planArr[0] as Record<string, unknown> | undefined;
  const rootPlan = (firstItem?.['Plan'] ?? firstItem ?? {}) as Record<string, unknown>;

  const topNodeType = String(rootPlan['Node Type'] ?? 'Unknown');
  const totalCost = Number(rootPlan['Total Cost'] ?? 0);
  const planRows = Number(rootPlan['Plan Rows'] ?? 0);
  const planWidth =
    rootPlan['Plan Width'] !== undefined ? Number(rootPlan['Plan Width']) : undefined;

  const planSummary = {
    top_node_type: topNodeType,
    total_cost: totalCost,
    plan_rows: planRows,
    ...(planWidth !== undefined ? { plan_width: planWidth } : {}),
  };

  const structured: ExplainResultT = {
    plan: planArr,
    plan_summary: planSummary,
    duration_ms: execResult.durationMs,
    warnings: [],
    request_id: rc.requestId,
  };

  // 6. Render text and return
  const text = renderExplain(structured);
  const payloadBytes = Buffer.byteLength(text, 'utf8');

  rc.rowsReturned = 1;
  rc.payloadBytes = payloadBytes;

  return {
    structured,
    text,
    rowsReturned: 1,
    payloadBytes,
    warnings: [],
  };
}

/**
 * MCP tool handler for explain.
 */
export async function explainTool(
  args: unknown,
  ctx: unknown,
  deps: ToolDeps,
): Promise<ToolResult> {
  const snapshot =
    deps.schemaCache?.get() ?? (deps as unknown as { snapshot?: SchemaSnapshot }).snapshot;
  if (!snapshot) {
    throw new Error('No schema snapshot available in dependencies');
  }

  return runTool('explain', args, ctx, deps, async (rc) => {
    const input = (args ?? {}) as ExplainInput;
    return executeExplain(input, rc, snapshot, deps);
  });
}
