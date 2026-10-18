import type { ErrorCode } from '../errors.generated.js';
import type { ParseResult } from '@pgsql/types';
import { walk, getNodeType, unwrap, type Scope } from './walk.js';
import {
  ALLOWED_TOP_LEVEL_STATEMENTS,
  isForbiddenNodeType,
  KNOWN_NODE_TYPES,
} from './statements.js';

export type StatementType = 'select' | 'explain' | 'show';

export type ClassificationResult =
  | {
      ok: true;
      statementType: StatementType;
    }
  | {
      ok: false;
      code: ErrorCode;
      message: string;
      node?: unknown;
    };

export type FunctionCheckHook = (
  funcNode: unknown,
  path: readonly (string | number)[],
  scope: Scope,
) => { ok: false; code: ErrorCode; message: string; node?: unknown } | null;

export interface ClassifyOptions {
  functionHook?: FunctionCheckHook;
}

export function classify(
  tree: ParseResult,
  options?: ClassifyOptions,
): ClassificationResult {
  // 1. Statement count (PGM-204)
  if (!tree.stmts || tree.stmts.length !== 1) {
    return {
      ok: false,
      code: 'PGM-204',
      message: `Expected exactly 1 statement, got ${tree.stmts ? tree.stmts.length : 0}`,
    };
  }

  // 2. Top-level type (PGM-201)
  const rootStmtWrapped = tree.stmts[0]?.stmt;
  const topLevelType = getNodeType(rootStmtWrapped);

  if (
    !topLevelType ||
    !ALLOWED_TOP_LEVEL_STATEMENTS.has(topLevelType as unknown as 'SelectStmt')
  ) {
    return {
      ok: false,
      code: 'PGM-201',
      message: `Statement type "${topLevelType ?? 'unknown'}" is not allowed in read-only mode`,
      node: rootStmtWrapped,
    };
  }

  let statementType: StatementType;
  if (topLevelType === 'SelectStmt') {
    statementType = 'select';
  } else if (topLevelType === 'ExplainStmt') {
    statementType = 'explain';
  } else {
    statementType = 'show';
  }

  // 3. EXPLAIN options: analyze present and not explicitly false (PGM-209)
  if (topLevelType === 'ExplainStmt') {
    const explain = unwrap(rootStmtWrapped) as Record<string, unknown>;
    if (Array.isArray(explain.options)) {
      for (const optWrapped of explain.options) {
        const opt = unwrap(optWrapped) as Record<string, unknown>;
        const defname =
          typeof opt?.defname === 'string' ? opt.defname.toLowerCase() : '';
        if (defname === 'analyze') {
          const arg = unwrap(opt.arg) as Record<string, unknown> | null;
          let isExplicitlyFalse = false;
          if (arg) {
            const sval =
              typeof arg.sval === 'string' ? arg.sval.toLowerCase() : '';
            const ival = typeof arg.ival === 'number' ? arg.ival : undefined;
            const boolval =
              typeof arg.boolval === 'boolean' ? arg.boolval : undefined;
            if (
              sval === 'false' ||
              sval === '0' ||
              sval === 'off' ||
              sval === 'no' ||
              ival === 0 ||
              boolval === false
            ) {
              isExplicitlyFalse = true;
            }
          }
          if (!isExplicitlyFalse) {
            return {
              ok: false,
              code: 'PGM-209',
              message:
                'EXPLAIN ANALYZE is not allowed because it executes the statement',
              node: optWrapped,
            };
          }
        }
      }
    }
  }

  // 4. Walk the tree for deeper checks
  let walkRefusal: ClassificationResult | null = null;

  walk(tree, (node, type, path, scope) => {
    if (walkRefusal) return;

    // Forbidden node anywhere
    if (isForbiddenNodeType(type)) {
      const isInsideCte =
        path.includes('CommonTableExpr') || path.includes('ctes');
      if (isInsideCte) {
        walkRefusal = {
          ok: false,
          code: 'PGM-203',
          message: `Data-modifying statement "${type}" is not allowed inside a CommonTableExpr (WITH clause)`,
          node,
        };
      } else {
        walkRefusal = {
          ok: false,
          code: 'PGM-201',
          message: `Statement type "${type}" is not allowed in read-only mode`,
          node,
        };
      }
      return;
    }

    // SelectStmt intoClause and lockingClause (PGM-202)
    if (type === 'SelectStmt') {
      const select = node as Record<string, unknown>;
      if (select.intoClause !== undefined) {
        walkRefusal = {
          ok: false,
          code: 'PGM-202',
          message: 'SELECT INTO is not allowed in read-only mode',
          node: select.intoClause,
        };
        return;
      }
      if (
        Array.isArray(select.lockingClause) &&
        select.lockingClause.length > 0
      ) {
        walkRefusal = {
          ok: false,
          code: 'PGM-202',
          message:
            'Row locking clauses (FOR UPDATE/SHARE) are not allowed in read-only mode',
          node: select.lockingClause,
        };
        return;
      }
    }

    if (type === 'IntoClause' || type === 'LockingClause') {
      walkRefusal = {
        ok: false,
        code: 'PGM-202',
        message: `Clause "${type}" is not allowed in read-only mode`,
        node,
      };
      return;
    }

    // DefElem only allowed under ExplainStmt options
    if (type === 'DefElem') {
      if (!path.includes('options')) {
        walkRefusal = {
          ok: false,
          code: 'PGM-201',
          message: 'DefElem node is only allowed under ExplainStmt options',
          node,
        };
        return;
      }
    }

    // Unknown node (PGM-201)
    if (!KNOWN_NODE_TYPES.has(type)) {
      walkRefusal = {
        ok: false,
        code: 'PGM-201',
        message: `Unknown or disallowed AST node type: "${type}"`,
        node,
      };
      return;
    }

    // Function check hook (for P2.4)
    if (type === 'FuncCall' && options?.functionHook) {
      const hookResult = options.functionHook(node, path, scope);
      if (hookResult) {
        walkRefusal = hookResult;
        return;
      }
    }
  });

  if (walkRefusal) {
    return walkRefusal;
  }

  return {
    ok: true,
    statementType,
  };
}
