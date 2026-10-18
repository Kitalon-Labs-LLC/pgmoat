/* eslint-disable security/detect-object-injection */
import { refuse } from '../errors.js';

export interface RelationInScope {
  alias: string | null;
  schema: string | null;
  name: string;
  isCte: boolean;
}

export interface Scope {
  parent?: Scope;
  ctes: Set<string>;
  relations: RelationInScope[];
  kind: 'select' | 'root';
}

export type VisitorFn = (
  node: unknown,
  type: string,
  path: readonly (string | number)[],
  scope: Scope,
) => void;

export function getNodeType(node: unknown): string | null {
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    const keys = Object.keys(node);
    if (
      keys.length === 1 &&
      typeof keys[0] === 'string' &&
      /^[A-Z]/.test(keys[0])
    ) {
      return keys[0];
    }
  }
  return null;
}

export function unwrap(node: unknown): unknown {
  const type = getNodeType(node);
  if (type !== null && node !== null && typeof node === 'object') {
    return (node as Record<string, unknown>)[type];
  }
  return node;
}

export function walk(tree: unknown, visitor: VisitorFn): void {
  const rootScope: Scope = {
    ctes: new Set(),
    relations: [],
    kind: 'root',
  };

  let root = tree;
  if (
    root !== null &&
    typeof root === 'object' &&
    'tree' in root &&
    (root as { tree: unknown }).tree !== undefined
  ) {
    root = (root as { tree: unknown }).tree;
  }

  walkNode(root, [], rootScope, 0, visitor);
}

function walkNode(
  curr: unknown,
  path: readonly (string | number)[],
  currentScope: Scope,
  depth: number,
  visitor: VisitorFn,
): void {
  if (depth > 1000) {
    throw refuse('PGM-206', 'AST depth exceeded limit of 1000');
  }

  if (curr === null || curr === undefined || typeof curr !== 'object') {
    return;
  }

  if (Array.isArray(curr)) {
    for (let i = 0; i < curr.length; i++) {
      walkNode(curr[i], [...path, i], currentScope, depth + 1, visitor);
    }
    return;
  }

  const type = getNodeType(curr);
  if (type !== null) {
    const inner = unwrap(curr);
    if (type === 'SelectStmt') {
      walkSelectStmt(inner, path, currentScope, depth, visitor);
      return;
    }

    visitor(inner, type, path, currentScope);
    walkObjectFields(inner, path, currentScope, depth, visitor);
    return;
  }

  // Not a wrapped node, walk its object properties
  walkObjectFields(curr, path, currentScope, depth, visitor);
}

function walkObjectFields(
  obj: unknown,
  path: readonly (string | number)[],
  scope: Scope,
  depth: number,
  visitor: VisitorFn,
): void {
  if (obj !== null && typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      walkNode(record[key], [...path, key], scope, depth + 1, visitor);
    }
  }
}

function walkSelectStmt(
  innerObj: unknown,
  path: readonly (string | number)[],
  currentScope: Scope,
  depth: number,
  visitor: VisitorFn,
): void {
  if (innerObj === null || typeof innerObj !== 'object') {
    return;
  }

  const select = innerObj as Record<string, unknown>;

  const selectScope: Scope = {
    parent: currentScope,
    ctes: new Set(currentScope.ctes),
    relations: [],
    kind: 'select',
  };

  // 1. Register withClause CTEs first (recursive CTEs see themselves)
  if (select.withClause && typeof select.withClause === 'object') {
    const withClause = select.withClause as Record<string, unknown>;
    if (Array.isArray(withClause.ctes)) {
      for (const cteWrapped of withClause.ctes) {
        const cte = unwrap(cteWrapped) as Record<string, unknown> | null;
        if (cte && typeof cte.ctename === 'string') {
          selectScope.ctes.add(cte.ctename);
        }
      }
    }
  }

  // 2. Visit this SelectStmt
  visitor(innerObj, 'SelectStmt', path, selectScope);

  // 3. Walk withClause
  if (select.withClause !== undefined) {
    walkNode(
      select.withClause,
      [...path, 'withClause'],
      selectScope,
      depth + 1,
      visitor,
    );
  }

  // 4. Set operations (op != SETOP_NONE, with larg/rarg): each arm gets its own scope;
  // the outer statement's withClause CTEs are visible to both.
  const op = select.op;
  if (typeof op === 'string' && op !== 'SETOP_NONE') {
    if (select.larg !== undefined) {
      const leftScope: Scope = {
        parent: selectScope,
        ctes: new Set(selectScope.ctes),
        relations: [],
        kind: 'select',
      };
      walkSelectArm(
        select.larg,
        [...path, 'larg'],
        leftScope,
        depth + 1,
        visitor,
      );
    }

    if (select.rarg !== undefined) {
      const rightScope: Scope = {
        parent: selectScope,
        ctes: new Set(selectScope.ctes),
        relations: [],
        kind: 'select',
      };
      walkSelectArm(
        select.rarg,
        [...path, 'rarg'],
        rightScope,
        depth + 1,
        visitor,
      );
    }

    const setOpClauses = [
      'sortClause',
      'limitCount',
      'limitOffset',
      'lockingClause',
    ];
    for (const clause of setOpClauses) {
      if (select[clause] !== undefined) {
        walkNode(
          select[clause],
          [...path, clause],
          selectScope,
          depth + 1,
          visitor,
        );
      }
    }
    return;
  }

  // 5. Normal SelectStmt: walk fromClause and register relations
  if (Array.isArray(select.fromClause)) {
    for (let i = 0; i < select.fromClause.length; i++) {
      walkFromItem(
        select.fromClause[i],
        [...path, 'fromClause', i],
        selectScope,
        depth + 1,
        visitor,
      );
    }
  }

  // 6. Walk remaining clauses with selectScope
  const standardClauses = [
    'distinctClause',
    'targetList',
    'intoClause',
    'whereClause',
    'groupClause',
    'groupingSets',
    'havingClause',
    'windowClause',
    'sortClause',
    'limitOffset',
    'limitCount',
    'lockingClause',
    'valuesLists',
  ];

  for (const clause of standardClauses) {
    if (select[clause] !== undefined) {
      walkNode(
        select[clause],
        [...path, clause],
        selectScope,
        depth + 1,
        visitor,
      );
    }
  }
}

function walkSelectArm(
  arm: unknown,
  path: readonly (string | number)[],
  armScope: Scope,
  depth: number,
  visitor: VisitorFn,
): void {
  const type = getNodeType(arm);
  if (type === 'SelectStmt') {
    walkSelectStmt(unwrap(arm), path, armScope, depth, visitor);
  } else if (arm !== null && typeof arm === 'object') {
    walkSelectStmt(arm, path, armScope, depth, visitor);
  }
}

function walkFromItem(
  fromItem: unknown,
  path: readonly (string | number)[],
  scope: Scope,
  depth: number,
  visitor: VisitorFn,
): void {
  if (fromItem === null || typeof fromItem !== 'object') {
    return;
  }

  const type = getNodeType(fromItem);
  const inner = (type !== null ? unwrap(fromItem) : fromItem) as Record<
    string,
    unknown
  >;

  if (type === 'RangeVar') {
    const relname = typeof inner.relname === 'string' ? inner.relname : '';
    const schema =
      typeof inner.schemaname === 'string' ? inner.schemaname : null;
    const aliasObj = inner.alias as { aliasname?: string } | undefined;
    const alias =
      typeof aliasObj?.aliasname === 'string' ? aliasObj.aliasname : null;
    const isCte = !schema && scope.ctes.has(relname);

    scope.relations.push({ alias, schema, name: relname, isCte });
    visitor(inner, 'RangeVar', path, scope);
    walkObjectFields(inner, path, scope, depth + 1, visitor);
    return;
  }

  if (type === 'RangeSubselect') {
    const aliasObj = inner.alias as { aliasname?: string } | undefined;
    const alias =
      typeof aliasObj?.aliasname === 'string' ? aliasObj.aliasname : null;

    visitor(inner, 'RangeSubselect', path, scope);
    if (inner.subquery !== undefined) {
      walkNode(
        inner.subquery,
        [...path, 'subquery'],
        scope,
        depth + 1,
        visitor,
      );
    }
    if (inner.alias !== undefined) {
      walkNode(inner.alias, [...path, 'alias'], scope, depth + 1, visitor);
    }
    scope.relations.push({
      alias,
      schema: null,
      name: alias ?? '',
      isCte: false,
    });
    return;
  }

  if (type === 'RangeFunction') {
    const aliasObj = inner.alias as { aliasname?: string } | undefined;
    const alias =
      typeof aliasObj?.aliasname === 'string' ? aliasObj.aliasname : null;

    visitor(inner, 'RangeFunction', path, scope);
    if (inner.functions !== undefined) {
      walkNode(
        inner.functions,
        [...path, 'functions'],
        scope,
        depth + 1,
        visitor,
      );
    }
    if (inner.alias !== undefined) {
      walkNode(inner.alias, [...path, 'alias'], scope, depth + 1, visitor);
    }
    scope.relations.push({
      alias,
      schema: null,
      name: alias ?? '',
      isCte: false,
    });
    return;
  }

  if (type === 'RangeTableSample') {
    visitor(inner, 'RangeTableSample', path, scope);
    if (inner.relation !== undefined) {
      walkFromItem(
        inner.relation,
        [...path, 'relation'],
        scope,
        depth + 1,
        visitor,
      );
    }
    for (const key of Object.keys(inner)) {
      if (key !== 'relation') {
        walkNode(inner[key], [...path, key], scope, depth + 1, visitor);
      }
    }
    return;
  }

  if (type === 'JoinExpr') {
    visitor(inner, 'JoinExpr', path, scope);

    if (inner.larg !== undefined) {
      walkFromItem(inner.larg, [...path, 'larg'], scope, depth + 1, visitor);
    }
    if (inner.rarg !== undefined) {
      walkFromItem(inner.rarg, [...path, 'rarg'], scope, depth + 1, visitor);
    }
    if (inner.quals !== undefined) {
      walkNode(inner.quals, [...path, 'quals'], scope, depth + 1, visitor);
    }
    if (inner.usingClause !== undefined) {
      walkNode(
        inner.usingClause,
        [...path, 'usingClause'],
        scope,
        depth + 1,
        visitor,
      );
    }
    if (inner.alias !== undefined) {
      const aliasObj = inner.alias as { aliasname?: string } | undefined;
      const alias =
        typeof aliasObj?.aliasname === 'string' ? aliasObj.aliasname : null;
      if (alias) {
        scope.relations.push({
          alias,
          schema: null,
          name: alias,
          isCte: false,
        });
      }
      walkNode(inner.alias, [...path, 'alias'], scope, depth + 1, visitor);
    }
    return;
  }

  // Fallback for general node
  walkNode(fromItem, path, scope, depth + 1, visitor);
}
