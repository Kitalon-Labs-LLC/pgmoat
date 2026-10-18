/* eslint-disable security/detect-object-injection */
import type { ErrorCode } from '../errors.generated.js';
import type { PolicyIndex, SchemaSnapshot } from '../types.js';
import type { PgmoatConfigT } from '../config/schema.js';
import { walk, getNodeType, unwrap, type Scope, type RelationInScope } from './walk.js';

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

export interface CheckColumnsOptions {
  snapshot?: SchemaSnapshot;
  visibleColumns?:
    | ReadonlyMap<string, readonly string[]>
    | Record<string, readonly string[]>;
}

export function checkRelations(
  tree: unknown,
  scopesOrIndex: unknown,
  indexOrPolicy?: unknown,
  maybePolicy?: unknown,
): PolicyResult {
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
          return;
        }

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

      // 3. Unqualified relation
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

function resolveRelationName(
  rel: RelationInScope,
  index: PolicyIndex,
): string | null {
  if (rel.isCte) {
    return null;
  }
  if (rel.schema) {
    return `${rel.schema}.${rel.name}`;
  }
  for (const schema of index.exposedSchemas) {
    const qual = `${schema}.${rel.name}`;
    if (index.knownRelations.has(qual)) {
      return qual;
    }
  }
  return null;
}

function findRelationInScope(
  qualifier: string,
  scope: Scope,
): RelationInScope | null {
  let curr: Scope | undefined = scope;
  while (curr) {
    for (const r of curr.relations) {
      if (r.alias === qualifier || (!r.alias && r.name === qualifier) || r.name === qualifier) {
        return r;
      }
    }
    curr = curr.parent;
  }
  return null;
}

function getScopeHiddenInfo(scope: Scope, index: PolicyIndex) {
  const hiddenColNames = new Set<string>();
  const tablesWithHiddenCols = new Map<string, string>(); // alias/name -> qualName

  let currScope: Scope | undefined = scope;
  while (currScope) {
    for (const rel of currScope.relations) {
      if (rel.isCte) continue;
      const qual = resolveRelationName(rel, index);
      if (qual) {
        const hiddenCols = index.hiddenColumns.get(qual);
        if (hiddenCols && hiddenCols.size > 0) {
          for (const c of hiddenCols) {
            hiddenColNames.add(c);
          }
          if (rel.alias) {
            tablesWithHiddenCols.set(rel.alias, qual);
          }
          tablesWithHiddenCols.set(rel.name, qual);
        }
      }
    }
    currScope = currScope.parent;
  }

  return { hiddenColNames, tablesWithHiddenCols };
}

function getVisibleColumns(
  qualName: string,
  index: PolicyIndex,
  options?: CheckColumnsOptions,
): readonly string[] | null {
  if (options?.visibleColumns) {
    if (options.visibleColumns instanceof Map) {
      const cols = options.visibleColumns.get(qualName);
      if (cols) return cols;
    } else {
      const rec = options.visibleColumns as Record<string, readonly string[]>;
      if (rec[qualName]) return rec[qualName];
    }
  }

  if (options?.snapshot?.byQualifiedName) {
    const relInfo = options.snapshot.byQualifiedName.get(qualName);
    if (relInfo) {
      return relInfo.columns.map((c) => c.name);
    }
  }

  const extIndex = index as PolicyIndex & {
    visibleColumns?: ReadonlyMap<string, readonly string[]>;
  };
  if (extIndex.visibleColumns) {
    const cols = extIndex.visibleColumns.get(qualName);
    if (cols) return cols;
  }

  return null;
}

function formatAllowedColumns(
  qualName: string,
  index: PolicyIndex,
  options?: CheckColumnsOptions,
): string {
  const cols = getVisibleColumns(qualName, index, options);
  if (cols && cols.length > 0) {
    return cols.slice(0, 40).join(', ');
  }
  return 'see schema';
}

export function checkColumns(
  tree: unknown,
  scopesOrIndex: unknown,
  indexOrPolicy?: unknown,
  maybePolicyOrOptions?: unknown,
  maybeOptions?: unknown,
): PolicyResult {
  let index: PolicyIndex;
  let policy: Partial<PgmoatConfigT['policy']> | undefined;
  let options: CheckColumnsOptions | undefined;

  if (
    scopesOrIndex !== null &&
    typeof scopesOrIndex === 'object' &&
    'exposedSchemas' in scopesOrIndex &&
    'knownRelations' in scopesOrIndex
  ) {
    index = scopesOrIndex as PolicyIndex;
    policy = indexOrPolicy as Partial<PgmoatConfigT['policy']> | undefined;
    options = maybePolicyOrOptions as CheckColumnsOptions | undefined;
  } else {
    index = indexOrPolicy as PolicyIndex;
    policy = maybePolicyOrOptions as Partial<PgmoatConfigT['policy']> | undefined;
    options = maybeOptions as CheckColumnsOptions | undefined;
  }

  const strictUnqualified = policy?.strict_unqualified_columns ?? true;
  let refusal: PolicyResult | null = null;

  walk(tree, (node, type, _path, scope) => {
    if (refusal) return;

    if (type === 'ColumnRef') {
      const colRef = node as Record<string, unknown>;
      const fields = Array.isArray(colRef.fields) ? colRef.fields : [];
      if (fields.length === 0) return;

      const extracted = fields.map((f) => {
        const unwrapped = unwrap(f) as Record<string, unknown> | null;
        const sval = typeof unwrapped?.sval === 'string' ? unwrapped.sval : null;
        const isStar =
          getNodeType(f) === 'A_Star' || (unwrapped !== null && typeof unwrapped === 'object' && 'A_Star' in unwrapped);
        return { sval, isStar };
      });

      const { hiddenColNames, tablesWithHiddenCols } = getScopeHiddenInfo(
        scope,
        index,
      );

      // Case 1: Unqualified star: SELECT *
      if (extracted.length === 1 && extracted[0]?.isStar) {
        if (tablesWithHiddenCols.size > 0) {
          const firstQual = Array.from(tablesWithHiddenCols.values())[0]!;
          refusal = {
            ok: false,
            code: 'PGM-208',
            // eslint-disable-next-line pgmoat/no-sql-string-building -- human-facing error message
            message: `Column access not allowed. Wildcard "*" on table with hidden columns. Allowed columns for ${firstQual}: ${formatAllowedColumns(firstQual, index, options)}`,
            node: colRef,
          };
          return;
        }
        return;
      }

      // Case 2: Length 1: Single String [x]
      if (extracted.length === 1 && extracted[0]?.sval !== null) {
        const name = extracted[0]!.sval!;

        // Subcase 2a: Whole-row reference
        if (tablesWithHiddenCols.has(name)) {
          const qual = tablesWithHiddenCols.get(name)!;
          refusal = {
            ok: false,
            code: 'PGM-208',
            message: `Column access not allowed. Whole-row reference to "${name}" exposes hidden columns. Allowed columns for ${qual}: ${formatAllowedColumns(qual, index, options)}`,
            node: colRef,
          };
          return;
        }

        // Subcase 2b: Unqualified column reference
        if (hiddenColNames.has(name)) {
          if (strictUnqualified) {
            let hidingTable = 'in-scope table';
            for (const qual of tablesWithHiddenCols.values()) {
              if (index.hiddenColumns.get(qual)?.has(name)) {
                hidingTable = qual;
                break;
              }
            }
            refusal = {
              ok: false,
              code: 'PGM-208',
              message: `Column access not allowed. Unqualified column "${name}" matches a hidden column. Qualify the column or use list_tables to see available columns. Allowed columns for ${hidingTable}: ${formatAllowedColumns(hidingTable, index, options)}`,
              node: colRef,
            };
            return;
          } else {
            // Non-strict: check if resolvable only to non-hidden table
            const hidingCandidates: string[] = [];
            const nonHidingCandidates: string[] = [];

            for (const qual of tablesWithHiddenCols.values()) {
              if (index.hiddenColumns.get(qual)?.has(name)) {
                hidingCandidates.push(qual);
              }
            }

            let currScope: Scope | undefined = scope;
            while (currScope) {
              for (const r of currScope.relations) {
                if (r.isCte) continue;
                const qual = resolveRelationName(r, index);
                if (qual && !index.hiddenColumns.get(qual)?.has(name)) {
                  const vis = getVisibleColumns(qual, index, options);
                  if (vis && vis.includes(name)) {
                    nonHidingCandidates.push(qual);
                  }
                }
              }
              currScope = currScope.parent;
            }

            if (hidingCandidates.length > 0 && nonHidingCandidates.length === 0) {
              const hidingTable = hidingCandidates[0]!;
              refusal = {
                ok: false,
                code: 'PGM-208',
                message: `Column access not allowed. Unqualified column "${name}" is hidden. Allowed columns for ${hidingTable}: ${formatAllowedColumns(hidingTable, index, options)}`,
                node: colRef,
              };
              return;
            } else if (hidingCandidates.length > 0 && nonHidingCandidates.length > 0) {
              // Ambiguous
              const hidingTable = hidingCandidates[0]!;
              refusal = {
                ok: false,
                code: 'PGM-208',
                message: `Column access not allowed. Ambiguous unqualified column "${name}" matches hidden column in ${hidingTable}. Allowed columns for ${hidingTable}: ${formatAllowedColumns(hidingTable, index, options)}`,
                node: colRef,
              };
              return;
            }
          }
        }
        return;
      }

      // Case 3: Length 2: [qualifier, *] or [qualifier, col]
      if (extracted.length === 2 && extracted[0]?.sval !== null) {
        const qualifier = extracted[0]!.sval!;

        // Subcase 3a: Qualified star: u.*
        if (extracted[1]?.isStar) {
          if (tablesWithHiddenCols.has(qualifier)) {
            const qual = tablesWithHiddenCols.get(qualifier)!;
            refusal = {
              ok: false,
              code: 'PGM-208',
              // eslint-disable-next-line pgmoat/no-sql-string-building -- human-facing error message
              message: `Column access not allowed. Wildcard "${qualifier}.*" on table with hidden columns. Allowed columns for ${qual}: ${formatAllowedColumns(qual, index, options)}`,
              node: colRef,
            };
            return;
          }
          return;
        }

        // Subcase 3b: Qualified column: u.col
        if (extracted[1]?.sval !== null) {
          const col = extracted[1]!.sval!;
          const matchedRel = findRelationInScope(qualifier, scope);
          if (matchedRel) {
            const qual = resolveRelationName(matchedRel, index);
            if (qual && index.hiddenColumns.get(qual)?.has(col)) {
              refusal = {
                ok: false,
                code: 'PGM-208',
                message: `Column access not allowed. Column "${qualifier}.${col}" is hidden. Allowed columns for ${qual}: ${formatAllowedColumns(qual, index, options)}`,
                node: colRef,
              };
              return;
            }
          }
          return;
        }
      }

      // Case 4: Length 3: [schema, table, *] or [schema, table, col]
      if (
        extracted.length === 3 &&
        extracted[0]?.sval !== null &&
        extracted[1]?.sval !== null
      ) {
        const schema = extracted[0]!.sval!;
        const table = extracted[1]!.sval!;
        const qual = `${schema}.${table}`;

        if (extracted[2]?.isStar) {
          if (index.hiddenColumns.get(qual)?.size) {
            refusal = {
              ok: false,
              code: 'PGM-208',
              // eslint-disable-next-line pgmoat/no-sql-string-building -- human-facing error message
              message: `Column access not allowed. Wildcard "${qual}.*" on table with hidden columns. Allowed columns for ${qual}: ${formatAllowedColumns(qual, index, options)}`,
              node: colRef,
            };
            return;
          }
          return;
        }

        if (extracted[2]?.sval !== null) {
          const col = extracted[2]!.sval!;
          if (index.hiddenColumns.get(qual)?.has(col)) {
            refusal = {
              ok: false,
              code: 'PGM-208',
              message: `Column access not allowed. Column "${qual}.${col}" is hidden. Allowed columns for ${qual}: ${formatAllowedColumns(qual, index, options)}`,
              node: colRef,
            };
            return;
          }
        }
      }
    }
  });

  if (refusal) {
    return refusal;
  }

  return { ok: true };
}
