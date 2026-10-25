import type { ErrorCode } from '../errors.generated.js';
import type { PolicyIndex, SafetyResult } from '../types.js';
import type { PgmoatConfigT } from '../config/schema.js';
import { parseSql } from './parse.js';
import { classify } from './classify.js';
import { checkRelations, checkColumns, type CheckColumnsOptions } from './policy.js';
import { rewrite, type RewriteContext } from './rewrite.js';
import { fingerprint } from './fingerprint.js';
import { getNodeType } from './walk.js';
import { PgmoatError } from '../errors.js';

export interface SafetyTimings {
  parseMs: number;
  classifyMs: number;
  policyMs: number;
  rewriteMs: number;
  fingerprintMs: number;
  totalMs: number;
}

export type PipelineSafetyResult = SafetyResult & {
  timings: SafetyTimings;
};

export interface SafetyContext {
  policyIndex: PolicyIndex;
  policy?: Partial<PgmoatConfigT['policy']>;
  budgets?: Partial<PgmoatConfigT['budgets']>;
  mode?: 'query' | 'explain';
  checkColumnsOptions?: CheckColumnsOptions;
}

/**
 * Pure function running the entire safety pipeline:
 * parse -> classify -> policy (relations & columns) -> rewrite -> fingerprint
 */
export async function runSafety(
  sql: string,
  ctx: SafetyContext,
): Promise<PipelineSafetyResult> {
  const startTotal = performance.now();
  const timings: SafetyTimings = {
    parseMs: 0,
    classifyMs: 0,
    policyMs: 0,
    rewriteMs: 0,
    fingerprintMs: 0,
    totalMs: 0,
  };

  const maxSqlChars = ctx.budgets?.max_sql_chars ?? 65_536;
  const maxRows = ctx.budgets?.max_rows ?? 200;

  // 1. Parse
  const t0 = performance.now();
  let parsedTree;
  try {
    const parseRes = await parseSql(sql, { maxSqlChars });
    parsedTree = parseRes.tree;
  } catch (err: unknown) {
    timings.parseMs = performance.now() - t0;
    timings.totalMs = performance.now() - startTotal;

    if (err instanceof PgmoatError) {
      const errRes: PipelineSafetyResult = {
        allowed: false,
        code: err.code as ErrorCode,
        message: err.message,
        timings,
      };
      if (err.hint !== undefined) {
        errRes.hint = err.hint;
      }
      return errRes;
    }
    return {
      allowed: false,
      code: 'PGM-206',
      message: err instanceof Error ? err.message : String(err),
      timings,
    };
  }
  timings.parseMs = performance.now() - t0;

  // 2. Classify, Policy, Rewrite, Fingerprint inside safety wrapper
  try {
    const t1 = performance.now();
    const classRes = classify(
      parsedTree,
      ctx.policy ? { config: { policy: ctx.policy } as unknown as Partial<PgmoatConfigT> } : undefined,
    );
    timings.classifyMs = performance.now() - t1;

    if (!classRes.ok) {
      timings.totalMs = performance.now() - startTotal;
      const failRes: PipelineSafetyResult = {
        allowed: false,
        code: classRes.code,
        message: classRes.message,
        timings,
      };
      if (classRes.node) {
        const nodeName = getNodeType(classRes.node);
        if (nodeName) {
          failRes.node = nodeName;
        }
      }
      return failRes;
    }

    // 3. Policy (Relations & Columns)
    const t2 = performance.now();
    const relRes = checkRelations(parsedTree, ctx.policyIndex, ctx.policy);
    if (!relRes.ok) {
      timings.policyMs = performance.now() - t2;
      timings.totalMs = performance.now() - startTotal;
      return {
        allowed: false,
        code: relRes.code,
        message: relRes.message,
        timings,
      };
    }

    const colRes = checkColumns(
      parsedTree,
      ctx.policyIndex,
      ctx.policy,
      ctx.checkColumnsOptions,
    );
    if (!colRes.ok) {
      timings.policyMs = performance.now() - t2;
      timings.totalMs = performance.now() - startTotal;
      return {
        allowed: false,
        code: colRes.code,
        message: colRes.message,
        timings,
      };
    }
    timings.policyMs = performance.now() - t2;

    // 4. Rewrite
    const t3 = performance.now();
    let sqlExecuted = sql;
    let limitInjected = false;
    let treeForFingerprint = parsedTree;

    if (ctx.mode !== 'explain') {
      const rewriteCtx: RewriteContext = {
        maxRows,
        originalSql: sql,
        policyIndex: ctx.policyIndex,
      };
      if (ctx.policy !== undefined) {
        rewriteCtx.policy = ctx.policy;
      }
      if (ctx.checkColumnsOptions !== undefined) {
        rewriteCtx.checkColumnsOptions = ctx.checkColumnsOptions;
      }

      const rewriteRes = await rewrite(parsedTree, rewriteCtx);

      timings.rewriteMs = performance.now() - t3;

      if (!rewriteRes.ok) {
        timings.totalMs = performance.now() - startTotal;
        return {
          allowed: false,
          code: rewriteRes.code,
          message: rewriteRes.message,
          timings,
        };
      }

      sqlExecuted = rewriteRes.sql;
      limitInjected = rewriteRes.limitInjected;
      treeForFingerprint = rewriteRes.tree;
    } else {
      timings.rewriteMs = performance.now() - t3;
    }

    // 5. Fingerprint
    const t4 = performance.now();
    const fp = await fingerprint(treeForFingerprint);
    timings.fingerprintMs = performance.now() - t4;

    timings.totalMs = performance.now() - startTotal;

    return {
      allowed: true,
      sql: sqlExecuted,
      fingerprint: fp,
      limitInjected,
      statementType: classRes.statementType,
      timings,
    };
  } catch (err: unknown) {
    timings.totalMs = performance.now() - startTotal;
    if (err instanceof PgmoatError) {
      const errRes: PipelineSafetyResult = {
        allowed: false,
        code: err.code as ErrorCode,
        message: err.message,
        timings,
      };
      if (err.hint !== undefined) {
        errRes.hint = err.hint;
      }
      return errRes;
    }
    return {
      allowed: false,
      code: 'PGM-206',
      message: err instanceof Error ? err.message : String(err),
      timings,
    };
  }
}

