/* eslint-disable security/detect-object-injection */
import type {
  SchemaSnapshot,
  RelationInfo,
  ColumnInfo,
  ForeignKeyInfo,
  IndexInfo,
  PolicyIndex,
  WriteRules,
  Sensitivity,
} from '../types.js';
import type { IntrospectionResult, RawRelationInfo } from '../postgres/introspect.js';
import type { PgmoatConfigT, TableAnnotationT } from '../config/schema.js';

export function findTableAnnotation(
  schema: string,
  name: string,
  tables: Record<string, TableAnnotationT>,
  searchSchemas: readonly string[],
  relations: readonly RawRelationInfo[],
): TableAnnotationT | undefined {
  const qualified = `${schema}.${name}`;
  // 1. Direct qualified match
  if (tables[qualified]) {
    return tables[qualified];
  }

  // 2. Unqualified match
  if (tables[name]) {
    // Resolve against searchSchemas order
    for (const s of searchSchemas) {
      if (relations.some((r) => r.schema === s && r.name === name)) {
        if (s === schema) {
          return tables[name];
        }
        break;
      }
    }
  }

  return undefined;
}

/**
 * Builds a SchemaSnapshot by merging raw catalog introspection with user-configured annotations.
 * Hidden relations and columns are strictly omitted from visible relations, foreign keys,
 * referencedBy arrays, and indexes, ensuring zero hidden metadata leaks.
 */
export function buildSnapshot(
  introspection: IntrospectionResult,
  config: PgmoatConfigT,
  builtAt = new Date(),
): SchemaSnapshot {
  const exposedSchemas = config.connection.schemas;
  const exposedSchemaSet = new Set(exposedSchemas);

  // Filter catalog relations to exposed schemas
  const catalogRelations = introspection.relations.filter((r) =>
    exposedSchemaSet.has(r.schema),
  );

  const knownRelations = new Set<string>(
    catalogRelations.map((r) => `${r.schema}.${r.name}`),
  );

  // 1. Build hidden sets for relations and columns
  const hiddenRelations = new Set<string>();
  const hiddenColumns = new Map<string, Set<string>>();

  for (const rawRel of catalogRelations) {
    const qualifiedName = `${rawRel.schema}.${rawRel.name}`;
    const annotation = findTableAnnotation(
      rawRel.schema,
      rawRel.name,
      config.tables,
      exposedSchemas,
      catalogRelations,
    );

    if (annotation?.hidden) {
      hiddenRelations.add(qualifiedName);
    }

    const colHiddenSet = new Set<string>();
    if (annotation?.columns) {
      for (const colName of Object.keys(annotation.columns)) {
        const colAnn = annotation.columns[colName];
        if (colAnn?.hidden) {
          colHiddenSet.add(colName);
        }
      }
    }
    hiddenColumns.set(qualifiedName, colHiddenSet);
  }

  // 2. Build visible RelationInfo objects (without referencedBy first)
  const visibleRelationsMap = new Map<string, RelationInfo>();

  for (const rawRel of catalogRelations) {
    const qualifiedName = `${rawRel.schema}.${rawRel.name}`;
    if (hiddenRelations.has(qualifiedName)) {
      continue;
    }

    const annotation = findTableAnnotation(
      rawRel.schema,
      rawRel.name,
      config.tables,
      exposedSchemas,
      catalogRelations,
    );

    const colHiddenSet = hiddenColumns.get(qualifiedName) ?? new Set();

    // Relation description: YAML, then pg comment, then 'Unannotated'
    const description =
      annotation?.description?.trim() ||
      rawRel.description?.trim() ||
      'Unannotated';

    // Filter columns
    const columns: ColumnInfo[] = [];
    let hiddenColumnCount = 0;

    for (const rawCol of rawRel.columns) {
      if (colHiddenSet.has(rawCol.name)) {
        hiddenColumnCount++;
        continue;
      }

      const colAnn = annotation?.columns?.[rawCol.name];
      const colDescription =
        colAnn?.description?.trim() || rawCol.description?.trim() || '';

      let sensitive: Sensitivity | null = null;
      if (colAnn?.sensitive) {
        sensitive = colAnn.sensitive;
      } else if (annotation?.sensitive_columns?.includes(rawCol.name)) {
        sensitive = 'high';
      }

      columns.push({
        name: rawCol.name,
        type: rawCol.type,
        notNull: rawCol.notNull,
        default: rawCol.default,
        ordinal: rawCol.ordinal,
        description: colDescription,
        sensitive,
        untrusted: Boolean(colAnn?.untrusted),
      });
    }

    // Primary key: omit if any column is hidden
    let primaryKey: string[] | null = null;
    if (rawRel.primaryKey) {
      const pkHasHidden = rawRel.primaryKey.some((col) => colHiddenSet.has(col));
      if (!pkHasHidden) {
        primaryKey = [...rawRel.primaryKey];
      }
    }

    // Unique keys: omit unique constraints containing hidden columns
    const uniqueKeys: string[][] = [];
    for (const uq of rawRel.uniqueKeys) {
      const uqHasHidden = uq.some((col) => colHiddenSet.has(col));
      if (!uqHasHidden) {
        uniqueKeys.push([...uq]);
      }
    }

    // Foreign keys: omit if referencing a hidden relation or using hidden columns
    const foreignKeys: ForeignKeyInfo[] = [];
    for (const fk of rawRel.foreignKeys) {
      const targetQualified = `${fk.references.schema}.${fk.references.relation}`;
      if (hiddenRelations.has(targetQualified)) {
        continue;
      }

      const fkHasHiddenLocal = fk.columns.some((col) => colHiddenSet.has(col));
      if (fkHasHiddenLocal) {
        continue;
      }

      const targetHiddenCols = hiddenColumns.get(targetQualified);
      const fkHasHiddenTarget = fk.references.columns.some(
        (col) => targetHiddenCols?.has(col),
      );
      if (fkHasHiddenTarget) {
        continue;
      }

      foreignKeys.push({
        name: fk.name,
        columns: [...fk.columns],
        references: {
          relation: targetQualified,
          columns: [...fk.references.columns],
        },
        onDelete: fk.onDelete,
      });
    }

    // Indexes: omit if referencing any hidden column
    const indexes: IndexInfo[] = [];
    for (const idx of rawRel.indexes) {
      const idxHasHidden = idx.columns.some((col) => colHiddenSet.has(col));
      if (!idxHasHidden) {
        indexes.push({
          name: idx.name,
          columns: [...idx.columns],
          unique: idx.unique,
          primary: idx.primary,
          definition: idx.definition,
        });
      }
    }

    const writeRules: WriteRules = {
      ops: annotation?.write ?? [],
      updateColumns: annotation?.update_columns ?? [],
      insertRequiredColumns: annotation?.insert_required_columns ?? [],
      insertDefaults: annotation?.insert_defaults ?? {},
      maxAffectedRows: annotation?.max_affected_rows ?? 100,
    };

    visibleRelationsMap.set(qualifiedName, {
      schema: rawRel.schema,
      name: rawRel.name,
      qualifiedName,
      kind: rawRel.kindName,
      description,
      rowEstimate: rawRel.rowEstimate,
      columns,
      hiddenColumnCount,
      primaryKey,
      uniqueKeys,
      foreignKeys,
      referencedBy: [],
      indexes,
      relationships: annotation?.relationships ?? [],
      rls: {
        enabled: rawRel.relrowsecurity,
        forced: rawRel.relforcerowsecurity,
      },
      owner: rawRel.owner,
      write: writeRules,
    });
  }

  // 3. Compute referencedBy across visible relations
  for (const sourceRel of visibleRelationsMap.values()) {
    for (const fk of sourceRel.foreignKeys) {
      const targetRel = visibleRelationsMap.get(fk.references.relation);
      if (targetRel) {
        targetRel.referencedBy.push({
          relation: sourceRel.qualifiedName,
          columns: [...fk.columns],
        });
      }
    }
  }

  // 4. Sort relations by schema ASC then name ASC
  const relations = Array.from(visibleRelationsMap.values()).sort((a, b) => {
    const sCmp = a.schema.localeCompare(b.schema);
    if (sCmp !== 0) return sCmp;
    return a.name.localeCompare(b.name);
  });

  const byQualifiedName = new Map<string, RelationInfo>(
    relations.map((r) => [r.qualifiedName, r]),
  );

  const policyIndex: PolicyIndex = {
    hiddenRelations,
    hiddenColumns,
    knownRelations,
    exposedSchemas,
  };

  return {
    builtAt,
    serverVersionNum: introspection.serverVersionNum,
    relations,
    byQualifiedName,
    hiddenCount: hiddenRelations.size,
    policyIndex,
  };
}
