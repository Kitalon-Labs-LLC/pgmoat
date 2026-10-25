import yaml from 'yaml';
import { AUTO_HIDE_REGEX, type RenderRelationInput } from './render-yaml.js';

export interface MergeStats {
  keptDescriptions: number;
  keptHiddenColumns: number;
  addedTables: number;
  addedColumns: number;
  staleTables: number;
}

export interface MergeResult {
  yaml: string;
  stats: MergeStats;
}

export function mergeYaml(
  existingYaml: string,
  discoveredRelations: RenderRelationInput[],
  options: {
    autoHideSecrets?: boolean;
    dateStr?: string;
  } = {},
): MergeResult {
  const dateStr = options.dateStr ?? new Date().toISOString().split('T')[0];
  const autoHide = options.autoHideSecrets ?? true;

  const doc = yaml.parseDocument(existingYaml);

  let tablesNode = doc.get('tables') as yaml.YAMLMap | undefined;
  if (!tablesNode) {
    tablesNode = new yaml.YAMLMap();
    doc.set('tables', tablesNode);
  }

  const discoveredMap = new Map<string, RenderRelationInput>();
  for (const r of discoveredRelations) {
    discoveredMap.set(r.name, r);
    discoveredMap.set(`${r.schema}.${r.name}`, r);
  }

  const stats: MergeStats = {
    keptDescriptions: 0,
    keptHiddenColumns: 0,
    addedTables: 0,
    addedColumns: 0,
    staleTables: 0,
  };

  const existingTableNames: string[] = [];
  for (const item of tablesNode.items) {
    const key = String(item.key);
    existingTableNames.push(key);
  }

  // 1. Process existing tables: mark stale or update columns
  for (const tableName of existingTableNames) {
    const tableItem = tablesNode.get(tableName, true) as yaml.YAMLMap | undefined;
    const discovered = discoveredMap.get(tableName);

    if (!discovered) {
      // Table no longer found in DB -> mark stale
      stats.staleTables++;
      const pair = tablesNode.items.find((it) => String(it.key) === tableName);
      if (pair && pair.key && typeof pair.key === 'object') {
        (pair.key as { commentBefore?: string }).commentBefore = ` STALE: not found in database on ${dateStr}`;
      }
      continue;
    }

    if (tableItem && typeof tableItem.get === 'function') {
      const desc = tableItem.get('description');
      if (desc && typeof desc === 'string' && desc.trim().length > 0) {
        stats.keptDescriptions++;
      }

      let colsNode = tableItem.get('columns', true) as yaml.YAMLMap | undefined;
      if (!colsNode) {
        colsNode = new yaml.YAMLMap();
        tableItem.set('columns', colsNode);
      }

      const existingColNames = new Set(colsNode.items.map((it) => String(it.key)));

      // Count kept hidden columns
      for (const colItem of colsNode.items) {
        const colVal = colItem.value as yaml.YAMLMap | undefined;
        if (colVal && colVal.get && colVal.get('hidden') === true) {
          stats.keptHiddenColumns++;
        }
      }

      // Add new columns from discovered
      for (const discCol of discovered.columns) {
        if (!existingColNames.has(discCol.name)) {
          stats.addedColumns++;
          const colMap = new yaml.YAMLMap();
          colMap.flow = true;
          if (autoHide && AUTO_HIDE_REGEX.test(discCol.name)) {
            colMap.set('hidden', true);
          } else {
            colMap.set('description', discCol.comment ?? '');
          }
          colsNode.set(discCol.name, colMap);
        }
      }
    }
  }

  // 2. Add completely new tables
  const existingSet = new Set(existingTableNames);
  for (const disc of discoveredRelations) {
    if (!existingSet.has(disc.name) && !existingSet.has(`${disc.schema}.${disc.name}`)) {
      stats.addedTables++;
      const tblMap = new yaml.YAMLMap();
      tblMap.set('description', disc.comment ?? '');

      const colsMap = new yaml.YAMLMap();
      for (const col of disc.columns) {
        const colMap = new yaml.YAMLMap();
        colMap.flow = true;
        if (autoHide && AUTO_HIDE_REGEX.test(col.name)) {
          colMap.set('hidden', true);
        } else {
          colMap.set('description', col.comment ?? '');
        }
        colsMap.set(col.name, colMap);
      }
      tblMap.set('columns', colsMap);
      tablesNode.set(disc.name, tblMap);
    }
  }

  return {
    yaml: doc.toString(),
    stats,
  };
}
