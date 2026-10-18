/* eslint-disable security/detect-object-injection */
import { isDeepStrictEqual } from 'node:util';
import { deparse as defaultDeparse } from 'pgsql-deparser';
import type { ParseResult } from '@pgsql/types';
import type { ErrorCode } from '../errors.generated.js';
import type { PolicyIndex } from '../types.js';
import type { PgmoatConfigT } from '../config/schema.js';
import { classify, type ClassifyOptions } from './classify.js';
import { checkRelations, checkColumns, type CheckColumnsOptions } from './policy.js';
import { parseSql } from './parse.js';
import { getNodeType } from './walk.js';

export type DeparseFunction = (tree: ParseResult) => Promise<string>;

export interface RewriteContext {
  maxRows: number;
  originalSql?: string;
  policyIndex?: PolicyIndex;
  policy?: Partial<PgmoatConfigT['policy']>;
  checkColumnsOptions?: CheckColumnsOptions;
  deparse?: DeparseFunction;
}

export type RewriteResult =
  | {
      ok: true;
      sql: string;
      limitInjected: boolean;
      tree: ParseResult;
    }
  | {
      ok: false;
      code: ErrorCode;
      message: string;
      node?: unknown;
      internalLog?: unknown;
    };

function isLocationField(key: string): boolean {
  return (
    key === 'location' ||
    key === 'stmt_location' ||
    key === 'stmt_len' ||
    key === 'list_start' ||
    key === 'list_end' ||
    key === 'rexpr_list_start' ||
    key === 'rexpr_list_end' ||
    key.endsWith('_location') ||
    key.endsWith('_len')
  );
}

export function stripLocations<T>(node: T): T {
  if (node === null || typeof node !== 'object') {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map((item) => stripLocations(item)) as unknown as T;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (isLocationField(key)) {
      continue;
    }
    result[key] = stripLocations(value);
  }
  return result as T;
}

export function normalizeAstForComparison(tree: ParseResult): unknown {
  const stripped = stripLocations(tree);
  const root = stripped.stmts?.[0]?.stmt;
  if (root && typeof root === 'object' && 'SelectStmt' in root) {
    const s = (root as { SelectStmt: Record<string, unknown> }).SelectStmt;
    delete s.limitCount;
    delete s.limitOption;
  }
  return stripped;
}

export async function rewrite(
  tree: ParseResult,
  ctx: RewriteContext,
): Promise<RewriteResult> {
  const deparseFn = ctx.deparse ?? defaultDeparse;

  const classifyOptions: ClassifyOptions | undefined = ctx.policy
    ? { config: { policy: ctx.policy } as unknown as Partial<PgmoatConfigT> }
    : undefined;

  // Run initial classification to verify validity
  const initialClass = classify(tree, classifyOptions);
  if (!initialClass.ok) {
    return initialClass;
  }

  // Non-select statements: ExplainStmt, VariableShowStmt
  const rootStmt = tree.stmts?.[0]?.stmt;
  const topLevelType = getNodeType(rootStmt);
  if (topLevelType === 'ExplainStmt' || topLevelType === 'VariableShowStmt') {
    const sql = ctx.originalSql ?? (await deparseFn(tree));
    return {
      ok: true,
      sql,
      limitInjected: false,
      tree,
    };
  }

  const clonedTree = structuredClone(tree);
  const rawSelectStmt = clonedTree.stmts?.[0]?.stmt;
  const selectStmt = (rawSelectStmt as { SelectStmt?: Record<string, unknown> })?.SelectStmt;

  if (!selectStmt) {
    return {
      ok: false,
      code: 'PGM-201',
      message: `Expected SelectStmt, got ${topLevelType ?? 'unknown'}`,
      node: rawSelectStmt,
    };
  }

  // Check LIMIT_OPTION_WITH_TIES: leave it unchanged
  if (selectStmt.limitOption === 'LIMIT_OPTION_WITH_TIES') {
    const sql = ctx.originalSql ?? (await deparseFn(tree));
    return {
      ok: true,
      sql,
      limitInjected: false,
      tree: clonedTree,
    };
  }

  let limitInjected = false;

  if (selectStmt.limitCount === undefined) {
    // Inject LIMIT maxRows + 1
    selectStmt.limitCount = {
      A_Const: {
        ival: {
          ival: ctx.maxRows + 1,
        },
      },
    };
    selectStmt.limitOption = 'LIMIT_OPTION_COUNT';
    limitInjected = true;
  } else {
    // Check if constant LIMIT
    const limitCountNode = selectStmt.limitCount as Record<string, unknown>;
    if ('A_Const' in limitCountNode) {
      const aConst = (limitCountNode.A_Const as { ival?: { ival?: number } }) ?? {};
      if ('ival' in aConst) {
        const n = aConst.ival?.ival ?? 0;
        if (n > ctx.maxRows) {
          return {
            ok: false,
            code: 'PGM-302',
            // eslint-disable-next-line pgmoat/no-sql-string-building -- human-facing error message
            message: `LIMIT ${n} is above this server's limit of ${ctx.maxRows} rows.`,
            node: selectStmt.limitCount,
          };
        }
      }
    }
    // Non-constant limit or valid constant limit: keep as is
    limitInjected = false;
  }

  // Deparse
  let rewrittenSql: string;
  try {
    rewrittenSql = await deparseFn(clonedTree);
  } catch (err) {
    return {
      ok: false,
      code: 'PGM-210',
      message: 'Internal safety invariant failed after rewrite. Report a bug; the query was not run',
      internalLog: {
        originalSql: ctx.originalSql,
        reason: `Deparse failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  // Invariant Re-check: Re-parse the deparsed SQL
  let reparsed: ParseResult;
  try {
    const parseRes = await parseSql(rewrittenSql);
    reparsed = parseRes.tree;
  } catch (err) {
    return {
      ok: false,
      code: 'PGM-210',
      message: 'Internal safety invariant failed after rewrite. Report a bug; the query was not run',
      internalLog: {
        originalSql: ctx.originalSql,
        rewrittenSql,
        reason: `Reparse failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  // Invariant Re-check: Classification
  const reparsedClass = classify(reparsed, classifyOptions);
  if (!reparsedClass.ok) {
    return {
      ok: false,
      code: 'PGM-210',
      message: 'Internal safety invariant failed after rewrite. Report a bug; the query was not run',
      internalLog: {
        originalSql: ctx.originalSql,
        rewrittenSql,
        reason: `Reparsed query classified as error: ${reparsedClass.code} ${reparsedClass.message}`,
      },
    };
  }

  if (reparsedClass.statementType !== initialClass.statementType) {
    return {
      ok: false,
      code: 'PGM-210',
      message: 'Internal safety invariant failed after rewrite. Report a bug; the query was not run',
      internalLog: {
        originalSql: ctx.originalSql,
        rewrittenSql,
        reason: `Statement type mismatch: original=${initialClass.statementType}, reparsed=${reparsedClass.statementType}`,
      },
    };
  }

  // Invariant Re-check: Policy relations & columns if policyIndex provided
  if (ctx.policyIndex) {
    const relRes = checkRelations(reparsed, ctx.policyIndex, ctx.policy);
    if (!relRes.ok) {
      return {
        ok: false,
        code: 'PGM-210',
        message: 'Internal safety invariant failed after rewrite. Report a bug; the query was not run',
        internalLog: {
          originalSql: ctx.originalSql,
          rewrittenSql,
          reason: `Reparsed query failed checkRelations: ${relRes.code} ${relRes.message}`,
        },
      };
    }

    const colRes = checkColumns(
      reparsed,
      ctx.policyIndex,
      ctx.policy,
      ctx.checkColumnsOptions,
    );
    if (!colRes.ok) {
      return {
        ok: false,
        code: 'PGM-210',
        message: 'Internal safety invariant failed after rewrite. Report a bug; the query was not run',
        internalLog: {
          originalSql: ctx.originalSql,
          rewrittenSql,
          reason: `Reparsed query failed checkColumns: ${colRes.code} ${colRes.message}`,
        },
      };
    }
  }

  // Invariant Re-check: AST comparison normalized
  const originalNorm = normalizeAstForComparison(tree);
  const reparsedNorm = normalizeAstForComparison(reparsed);

  if (!isDeepStrictEqual(originalNorm, reparsedNorm)) {
    return {
      ok: false,
      code: 'PGM-210',
      message: 'Internal safety invariant failed after rewrite. Report a bug; the query was not run',
      internalLog: {
        originalSql: ctx.originalSql,
        rewrittenSql,
        reason: 'Normalized ASTs differ after deparse/reparse',
      },
    };
  }

  // Check that the limit node in reparsed matches clonedTree
  const reparsedSelect = (reparsed.stmts?.[0]?.stmt as { SelectStmt?: Record<string, unknown> })?.SelectStmt;
  const clonedLimit = stripLocations(selectStmt.limitCount);
  const reparsedLimit = stripLocations(reparsedSelect?.limitCount);

  if (!isDeepStrictEqual(clonedLimit, reparsedLimit)) {
    return {
      ok: false,
      code: 'PGM-210',
      message: 'Internal safety invariant failed after rewrite. Report a bug; the query was not run',
      internalLog: {
        originalSql: ctx.originalSql,
        rewrittenSql,
        reason: 'Limit nodes differ after deparse/reparse',
      },
    };
  }

  return {
    ok: true,
    sql: rewrittenSql,
    limitInjected,
    tree: reparsed,
  };
}
