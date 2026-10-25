import { performance } from 'node:perf_hooks';
import { isPgmoatError, fail, type ErrorCode } from '../errors.js';
import { renderRefusal } from '../output/text.js';
import { buildEntry, type RequestOutcome, type EntryMeta } from '../audit/entry.js';
import type { RequestContext, ToolName } from '../types.js';
import { createRequestContext, type ToolDeps } from './context.js';

export interface ToolOutcome {
  readonly structured: unknown;
  readonly text: string;
  readonly rowsReturned?: number | null;
  readonly payloadBytes?: number | null;
  readonly warnings?: readonly string[];
}

export interface ToolSuccessResult {
  readonly content: readonly [{ readonly type: 'text'; readonly text: string }];
  readonly structuredContent: unknown;
  readonly _meta: {
    readonly 'com.kitalonlabs.pgmoat/request_id': string;
    readonly [key: string]: unknown;
  };
}

export interface ToolErrorResult {
  readonly isError: true;
  readonly content: readonly [{ readonly type: 'text'; readonly text: string }];
  readonly _meta: {
    readonly 'com.kitalonlabs.pgmoat/error_code': ErrorCode;
    readonly 'com.kitalonlabs.pgmoat/request_id': string;
    readonly [key: string]: unknown;
  };
}

export type ToolResult = ToolSuccessResult | ToolErrorResult;

/**
 * Executes a tool core with RequestContext lifecycle, audit emission in finally,
 * and consistent error / refusal mapping.
 */
export async function runTool(
  name: ToolName,
  args: unknown,
  ctx: unknown,
  deps: ToolDeps,
  core: (rc: RequestContext) => Promise<ToolOutcome>,
): Promise<ToolResult> {
  const rc = createRequestContext(name, args, ctx, deps);
  const startTime = performance.now();

  let outcome: RequestOutcome = {
    status: 'error',
    errorCode: 'PGM-506',
    errorMessage: null,
  };

  let toolResult: ToolResult | null = null;

  try {
    const res = await core(rc);

    if (res.rowsReturned !== undefined && res.rowsReturned !== null) {
      rc.rowsReturned = res.rowsReturned;
    }
    if (res.payloadBytes !== undefined && res.payloadBytes !== null) {
      rc.payloadBytes = res.payloadBytes;
    }
    if (res.warnings && res.warnings.length > 0) {
      rc.warnings.push(...res.warnings);
    }

    outcome = {
      status: 'success',
      errorCode: null,
      errorMessage: null,
      rowsReturned: rc.rowsReturned,
    };

    toolResult = {
      content: [{ type: 'text', text: res.text }],
      structuredContent: res.structured,
      _meta: {
        'com.kitalonlabs.pgmoat/request_id': rc.requestId,
      },
    };

    return toolResult;
  } catch (err) {
    if (rc.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      outcome = {
        status: 'canceled',
        errorCode: isPgmoatError(err) ? err.code : null,
        errorMessage: 'Request was canceled',
      };
      const cancelErr = isPgmoatError(err)
        ? err
        : fail('PGM-303', 'Request was canceled');
      toolResult = {
        isError: true,
        content: [{ type: 'text', text: renderRefusal(cancelErr) }],
        _meta: {
          'com.kitalonlabs.pgmoat/error_code': cancelErr.code,
          'com.kitalonlabs.pgmoat/request_id': rc.requestId,
        },
      };
      return toolResult;
    }

    if (isPgmoatError(err)) {
      outcome = {
        status: err.kind === 'refused' ? 'refused' : err.kind === 'canceled' ? 'canceled' : 'error',
        errorCode: err.code,
        errorMessage: err.message,
      };

      toolResult = {
        isError: true,
        content: [{ type: 'text', text: renderRefusal(err) }],
        _meta: {
          'com.kitalonlabs.pgmoat/error_code': err.code,
          'com.kitalonlabs.pgmoat/request_id': rc.requestId,
        },
      };
      return toolResult;
    }

    // Unknown error: log stack to stderr, never leak stack to client
    const errObj = err instanceof Error ? err : new Error(String(err));
    process.stderr.write(
      `[pgmoat:error] Unhandled error in tool '${name}' [request ${rc.requestId}]: ${errObj.stack ?? errObj.message}\n`,
    );

    const genericErr = fail(
      'PGM-506',
      'An internal error occurred while processing the request.',
    );

    outcome = {
      status: 'error',
      errorCode: 'PGM-506',
      errorMessage: genericErr.message,
    };

    toolResult = {
      isError: true,
      content: [{ type: 'text', text: renderRefusal(genericErr) }],
      _meta: {
        'com.kitalonlabs.pgmoat/error_code': 'PGM-506',
        'com.kitalonlabs.pgmoat/request_id': rc.requestId,
      },
    };
    return toolResult;
  } finally {
    const durationMs = performance.now() - startTime;
    const entryMeta: EntryMeta = {
      serverName: deps.config.server.name,
      budgetMaxRows: deps.config.budgets.max_rows,
      budgetMaxQueryMs: deps.config.budgets.max_query_ms,
      durationMs,
      unsafeRoleOverride: Boolean(deps.unsafeRoleOverride),
    };

    try {
      const entry = buildEntry(rc, outcome, entryMeta);
      deps.audit.emit(entry);
    } catch (auditErr) {
      process.stderr.write(
        `[pgmoat:audit-error] Failed to emit audit entry for request ${rc.requestId}: ${
          auditErr instanceof Error ? auditErr.message : String(auditErr)
        }\n`,
      );
    }
  }
}
