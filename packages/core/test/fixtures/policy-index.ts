import type { PolicyIndex } from '../../src/types.js';

export interface CreatePolicyIndexOptions {
  exposedSchemas?: string[];
  knownRelations?: string[];
  hiddenRelations?: string[];
  hiddenColumns?: Record<string, string[]>;
}

export function createPolicyIndex(
  options?: CreatePolicyIndexOptions,
): PolicyIndex {
  const exposedSchemas = options?.exposedSchemas ?? ['public'];
  const knownRelations = new Set(options?.knownRelations ?? []);
  const hiddenRelations = new Set(options?.hiddenRelations ?? []);

  // Spec: knownRelations includes hidden relations
  for (const h of hiddenRelations) {
    knownRelations.add(h);
  }

  const hiddenColumnsMap = new Map<string, ReadonlySet<string>>();
  if (options?.hiddenColumns) {
    for (const [rel, cols] of Object.entries(options.hiddenColumns)) {
      hiddenColumnsMap.set(rel, new Set(cols));
    }
  }

  return {
    exposedSchemas,
    knownRelations,
    hiddenRelations,
    hiddenColumns: hiddenColumnsMap,
  };
}
