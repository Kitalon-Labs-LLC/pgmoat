import { refuse } from '../errors.js';
import { resolveRls } from '../rls/resolve.js';
import { runSafety } from '../safety/pipeline.js';
import { executeRead, type ExecuteBudgets } from '../postgres/execute.js';
import { applyBudgets, type ApplyBudgetsExtras } from '../budgets/index.js';
import { renderRows } from '../output/text.js';
import type { SchemaSnapshot, RequestContext } from '../types.js';
import type { Pools } from '../postgres/pool.js';
import { runTool, type ToolOutcome, type ToolResult } from './run-tool.js';
import type { ToolDeps } from './context.js';

export interface QueryInput {
  readonly sql: string;
}

/**
 * Runs the complete governed query execution lifecycle:
 * 1. Resolve RLS session variables (before parsing)
 * 2. Run AST safety pipeline (mode: 'query')
 * 3. Execute inside BEGIN READ ONLY with transaction-local limits via pg-cursor
 * 4. Apply query budgets (row, column, cell, payload limits)
 * 5. Render framed untrusted Markdown output
 * 6. Populate RequestContext for tamper-evident audit logging
 */
export async function executeQuery(
  input: QueryInput,
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

  // 2. Run Safety pipeline
  const safetyResult = await runSafety(input.sql, {
    policyIndex: snapshot.policyIndex,
    policy: deps.config.policy,
    budgets: deps.config.budgets,
    mode: 'query',
  });

  if (!safetyResult.allowed) {
    throw refuse(safetyResult.code, safetyResult.message);
  }

  rc.sqlExecuted = safetyResult.sql;
  rc.sqlFingerprint = safetyResult.fingerprint;

  // 3. Execution
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
    max_rows: deps.config.budgets.max_rows,
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

  // 4. Apply budgets
  const untrustedCols = new Set<string>();
  const sensitiveCols = new Set<string>();
  for (const rel of snapshot.relations) {
    for (const col of rel.columns) {
      if (col.untrusted) untrustedCols.add(col.name);
      if (col.sensitive) sensitiveCols.add(col.name);
    }
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
  const payloadBytes = budgetOutcome.payloadBytes;

  // 5. Render framed text
  const text = renderRows(rowsResult, execResult.durationMs);

  // 6. Record metrics in RequestContext for audit
  rc.rowsReturned = rowsResult.row_count;
  rc.payloadBytes = payloadBytes;
  if (rowsResult.warnings && rowsResult.warnings.length > 0) {
    for (const w of rowsResult.warnings) {
      rc.warnings.push(`${w.code}: ${w.message}`);
    }
  }

  return {
    structured: rowsResult,
    text,
    rowsReturned: rowsResult.row_count,
    payloadBytes,
    warnings: [...rc.warnings],
  };
}

/**
 * MCP tool handler for query.
 */
export async function queryTool(
  args: unknown,
  ctx: unknown,
  deps: ToolDeps,
): Promise<ToolResult> {
  const snapshot =
    deps.schemaCache?.get() ?? (deps as unknown as { snapshot?: SchemaSnapshot }).snapshot;
  if (!snapshot) {
    throw new Error('No schema snapshot available in dependencies');
  }

  return runTool('query', args, ctx, deps, async (rc) => {
    const input = (args ?? {}) as QueryInput;
    return executeQuery(input, rc, snapshot, deps);
  });
}
