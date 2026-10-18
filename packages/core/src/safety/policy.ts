import type { ErrorCode } from '../errors.generated.js';
import type { PolicyIndex } from '../types.js';
import type { PgmoatConfigT } from '../config/schema.js';
import { walk, type Scope } from './walk.js';

export type PolicyResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      code: ErrorCode;
      message: string;
      node?: unknown;
    };

export function checkRelations(
  tree: unknown,
  scopesOrIndex: unknown,
  indexOrPolicy?: unknown,
  maybePolicy?: unknown,
): PolicyResult {
  // Support either (tree, index, policy) or (tree, scopes, index, policy)
  let index: PolicyIndex;
  let policy: Partial<PgmoatConfigT['policy']> | undefined;

  if (
    scopesOrIndex !== null &&
    typeof scopesOrIndex === 'object' &&
    'exposedSchemas' in scopesOrIndex &&
    'knownRelations' in scopesOrIndex
  ) {
    index = scopesOrIndex as PolicyIndex;
    policy = indexOrPolicy as Partial<PgmoatConfigT['policy']> | undefined;
  } else {
    index = indexOrPolicy as PolicyIndex;
    policy = maybePolicy as Partial<PgmoatConfigT['policy']> | undefined;
  }

  const allowCatalogQueries = policy?.allow_catalog_queries ?? false;
  let refusal: PolicyResult | null = null;

  walk(tree, (node, type, _path, scope) => {
    if (refusal) return;

    if (type === 'RangeVar') {
      const rangeVar = node as Record<string, unknown>;
      const relname =
        typeof rangeVar.relname === 'string' ? rangeVar.relname : '';
      const schemaname =
        typeof rangeVar.schemaname === 'string' ? rangeVar.schemaname : null;

      // 1. If unqualified and matches a CTE in current or outer scope, it's a CTE
      if (!schemaname) {
        let currScope: Scope | undefined = scope;
        let isCte = false;
        while (currScope) {
          if (currScope.ctes.has(relname)) {
            isCte = true;
            break;
          }
          currScope = currScope.parent;
        }
        if (isCte) {
          return;
        }
      }

      // 2. Schema-qualified relation
      if (schemaname) {
        const schema = schemaname;
        const isCatalog =
          schema === 'pg_catalog' ||
          schema === 'information_schema' ||
          schema === 'pg_toast';

        if (isCatalog) {
          if (!allowCatalogQueries) {
            refusal = {
              ok: false,
              code: 'PGM-207',
              message:
                'Table not available. Use list_tables to see the tables you can query.',
              node: rangeVar,
            };
            return;
          }
          // Catalog queries allowed
          return;
        }

        // Non-catalog schema: must be in exposed schemas
        if (!index.exposedSchemas.includes(schema)) {
          refusal = {
            ok: false,
            code: 'PGM-207',
            message:
              'Table not available. Use list_tables to see the tables you can query.',
            node: rangeVar,
          };
          return;
        }

        const qualified = `${schema}.${relname}`;
        if (
          !index.knownRelations.has(qualified) ||
          index.hiddenRelations.has(qualified)
        ) {
          refusal = {
            ok: false,
            code: 'PGM-207',
            message:
              'Table not available. Use list_tables to see the tables you can query.',
            node: rangeVar,
          };
          return;
        }

        return;
      }

      // 3. Unqualified relation: search exposedSchemas in order
      let resolvedQualified: string | null = null;
      for (const schema of index.exposedSchemas) {
        const qualified = `${schema}.${relname}`;
        if (index.knownRelations.has(qualified)) {
          resolvedQualified = qualified;
          break;
        }
      }

      if (
        resolvedQualified === null ||
        index.hiddenRelations.has(resolvedQualified)
      ) {
        refusal = {
          ok: false,
          code: 'PGM-207',
          message:
            'Table not available. Use list_tables to see the tables you can query.',
          node: rangeVar,
        };
        return;
      }
    }
  });

  if (refusal) {
    return refusal;
  }

  return { ok: true };
}
