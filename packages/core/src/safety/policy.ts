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
      /** Render exactly like a database error (no hint), so hidden columns look missing. */
      asDatabaseError?: true;
      node?: unknown;
    };

/**
 * Refusal for a hidden column. It must be indistinguishable from a column that
 * does not exist, so it reproduces Postgres's undefined_column message, which
 * postgres/errors.ts passes through as PGM-506.
 */
function missingColumn(node: unknown, name: string, relname?: string): PolicyResult {
  return {
    ok: false,
    code: 'PGM-506',
    asDatabaseError: true,
    message: relname
      ? `column ${relname}.${name} does not exist`
      : `column "${name}" does not exist`,
    node,
  };
}

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

    if (type === 'TypeCast') {
      const tc = node as Record<string, unknown>;
      const typeName = tc.typeName as Record<string, unknown> | undefined;
      const names = Array.isArray(typeName?.names) ? typeName.names : [];
      let isReg = false;
      let regKind: string | null = null;
      for (const n of names) {
        const unwrapped = unwrap(n) as Record<string, unknown> | null;
        const sval = typeof unwrapped?.sval === 'string' ? unwrapped.sval.toLowerCase() : '';
        if (
          sval === 'regclass' ||
          sval === 'regrole' ||
          sval === 'regnamespace' ||
          sval === 'regproc' ||
          sval === 'regprocedure' ||
          sval === 'regoper' ||
          sval === 'regoperator' ||
          sval === 'regtype' ||
          sval === 'regconfig' ||
          sval === 'regdictionary'
        ) {
          isReg = true;
          regKind = sval;
          break;
        }
      }

      if (isReg) {
        const arg = unwrap(tc.arg) as Record<string, unknown> | null;
        const sval =
          arg && typeof arg.sval === 'object' && arg.sval !== null && 'sval' in arg.sval
            ? String((arg.sval as { sval: unknown }).sval)
            : arg && typeof arg.sval === 'string'
              ? arg.sval
              : null;

        if (sval) {
          const trimmed = sval.trim().replace(/^['"]|['"]$/g, '');
          if (regKind === 'regnamespace') {
            if (!index.exposedSchemas.includes(trimmed)) {
              refusal = {
                ok: false,
                code: 'PGM-207',
                message:
                  'Table not available. Use list_tables to see the tables you can query.',
                node: tc,
              };
              return;
            }
          } else {
            const resolved = resolveRelationFromIndex(trimmed, index);
            if (!resolved) {
              refusal = {
                ok: false,
                code: 'PGM-207',
                message:
                  'Table not available. Use list_tables to see the tables you can query.',
                node: tc,
              };
              return;
            }
          }
        }
      }
      return;
    }

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
      if (rel.isCte) {
        for (const schema of index.exposedSchemas) {
          const qual = `${schema}.${rel.name}`;
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
        continue;
      }
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
  return 'use describe_table to list them';
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

    if (type === 'RangeVar') {
      const rangeVar = node as Record<string, unknown>;
      if (
        rangeVar.alias &&
        typeof rangeVar.alias === 'object' &&
        Array.isArray((rangeVar.alias as Record<string, unknown>).colnames) &&
        ((rangeVar.alias as Record<string, unknown>).colnames as unknown[]).length > 0
      ) {
        const relname = typeof rangeVar.relname === 'string' ? rangeVar.relname : '';
        const schemaname = typeof rangeVar.schemaname === 'string' ? rangeVar.schemaname : null;
        let hasHidden = false;
        if (schemaname) {
          const qual = `${schemaname}.${relname}`;
          if (index.hiddenColumns.get(qual)?.size) hasHidden = true;
        } else {
          for (const s of index.exposedSchemas) {
            const qual = `${s}.${relname}`;
            if (index.hiddenColumns.get(qual)?.size) {
              hasHidden = true;
              break;
            }
          }
        }
        if (hasHidden) {
          refusal = {
            ok: false,
            code: 'PGM-208',
            message:
              'Column access not allowed. Column alias lists are not permitted on tables with hidden columns.',
            node: rangeVar,
          };
          return;
        }
      }
      return;
    }

    if (type === 'JoinExpr') {
      const join = node as Record<string, unknown>;
      const { hiddenColNames, tablesWithHiddenCols } = getScopeHiddenInfo(scope, index);

      // Check usingClause
      if (Array.isArray(join.usingClause) && join.usingClause.length > 0) {
        for (const item of join.usingClause) {
          const unwrapped = unwrap(item) as Record<string, unknown> | null;
          const sval = typeof unwrapped?.sval === 'string' ? unwrapped.sval : null;
          if (sval) {
            let isHidden = hiddenColNames.has(sval);
            if (!isHidden) {
              for (const cols of index.hiddenColumns.values()) {
                if (cols.has(sval)) {
                  isHidden = true;
                  break;
                }
              }
            }
            if (isHidden) {
              // Postgres checks the left side first; name the side the column is hidden on.
              const larg = unwrap(join.larg) as Record<string, unknown> | null;
              const leftQual =
                larg && typeof larg.relname === 'string'
                  ? resolveRelationName(
                      {
                        alias: null,
                        schema: typeof larg.schemaname === 'string' ? larg.schemaname : null,
                        name: larg.relname,
                        isCte: false,
                      },
                      index,
                    )
                  : null;
              const side =
                leftQual && getVisibleColumns(leftQual, index, options)?.includes(sval)
                  ? 'right'
                  : 'left';
              refusal = {
                ok: false,
                code: 'PGM-506',
                asDatabaseError: true,
                // eslint-disable-next-line pgmoat/no-sql-string-building -- human-facing error message
                message: `column "${sval}" specified in USING clause does not exist in ${side} table`,
                node: join,
              };
              return;
            }
          }
        }
      }

      // Check isNatural
      if (join.isNatural === true) {
        let anyHidden = tablesWithHiddenCols.size > 0;
        if (!anyHidden) {
          for (const cols of index.hiddenColumns.values()) {
            if (cols.size > 0) {
              anyHidden = true;
              break;
            }
          }
        }
        if (anyHidden) {
          refusal = {
            ok: false,
            code: 'PGM-208',
            message:
              'Column access not allowed. NATURAL JOIN is not permitted on tables with hidden columns.',
            node: join,
          };
          return;
        }
      }
      return;
    }

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
            refusal = missingColumn(colRef, name);
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
              refusal = missingColumn(colRef, name);
              return;
            } else if (hidingCandidates.length > 0 && nonHidingCandidates.length > 0) {
              // Ambiguous
              // Same message Postgres gives when the name exists in two in-scope tables.
              refusal = {
                ok: false,
                code: 'PGM-506',
                asDatabaseError: true,
                message: `column reference "${name}" is ambiguous`,
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
              refusal = missingColumn(colRef, col, qualifier);
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
            refusal = missingColumn(colRef, col, table);
            return;
          }
        }
      }

      // Case 5: Length 4: [db, schema, table, *] or [db, schema, table, col]
      if (
        extracted.length === 4 &&
        extracted[1]?.sval !== null &&
        extracted[2]?.sval !== null
      ) {
        const schema = extracted[1]!.sval!;
        const table = extracted[2]!.sval!;
        const qual = `${schema}.${table}`;

        if (extracted[3]?.isStar) {
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

        if (extracted[3]?.sval !== null) {
          const col = extracted[3]!.sval!;
          if (index.hiddenColumns.get(qual)?.has(col)) {
            refusal = missingColumn(colRef, col, table);
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

/**
 * Resolves a qualified or unqualified relation name against the policy index.
 * Returns the qualified relation name if visible, or null if hidden/unknown.
 */
export function resolveRelationFromIndex(
  tableName: string,
  index: PolicyIndex,
): string | null {
  const trimmed = tableName.trim();
  const dotIndex = trimmed.indexOf('.');
  if (dotIndex !== -1) {
    const schema = trimmed.slice(0, dotIndex);
    const relname = trimmed.slice(dotIndex + 1);
    if (!index.exposedSchemas.includes(schema)) {
      return null;
    }
    const qualified = `${schema}.${relname}`;
    if (
      !index.knownRelations.has(qualified) ||
      index.hiddenRelations.has(qualified)
    ) {
      return null;
    }
    return qualified;
  }

  for (const schema of index.exposedSchemas) {
    const qualified = `${schema}.${trimmed}`;
    if (index.knownRelations.has(qualified)) {
      if (index.hiddenRelations.has(qualified)) {
        return null;
      }
      return qualified;
    }
  }

  return null;
}
