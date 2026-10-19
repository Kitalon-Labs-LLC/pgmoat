import fs from 'node:fs';
import path from 'node:path';
import {
  loadConfig,
  createPools,
  introspect,
  buildSnapshot,
  refuse,
} from '@pgmoat/core';
import { exitWithError } from '../exit.js';

export interface SchemaExportOptions {
  config?: string | undefined;
  output?: string | undefined;
  includeHiddenCount?: boolean | undefined;
}

export function formatRelationMarkdown(
  rel: {
    qualifiedName: string;
    kind: string;
    description: string;
    rowEstimate: number;
    columns: Array<{
      name: string;
      type: string;
      notNull: boolean;
      description: string;
      sensitive?: string | null;
      untrusted?: boolean;
    }>;
    primaryKey: readonly string[] | null;
    uniqueKeys: readonly (readonly string[])[];
    foreignKeys: Array<{
      name: string;
      columns: readonly string[];
      references: { relation: string; columns: readonly string[] };
    }>;
    referencedBy: Array<{
      relation: string;
      columns: readonly string[];
    }>;
    hiddenColumnCount: number;
  },
  includeHiddenCount = false,
): string {
  const lines: string[] = [];
  const estPart = rel.rowEstimate >= 0 ? ` (~${rel.rowEstimate.toLocaleString()} rows)` : '';
  lines.push(`## ${rel.qualifiedName} (${rel.kind})${estPart}`);
  lines.push('');
  if (rel.description) {
    lines.push(rel.description);
    lines.push('');
  }

  lines.push('### Columns');
  lines.push('');
  lines.push('| Column | Type | Nullable | Attributes | Description |');
  lines.push('|---|---|---|---|---|');

  const pkSet = new Set(rel.primaryKey ?? []);
  const uniqueCols = new Set(rel.uniqueKeys.flat());

  for (const col of rel.columns) {
    const nullable = col.notNull ? 'NO' : 'YES';
    const attrs: string[] = [];
    if (pkSet.has(col.name)) attrs.push('PK');
    else if (uniqueCols.has(col.name)) attrs.push('UNIQUE');
    if (col.sensitive) attrs.push(`sensitive:${col.sensitive}`);
    if (col.untrusted) attrs.push('untrusted');

    const attrStr = attrs.length > 0 ? attrs.join(', ') : '-';
    const descStr = col.description || '-';
    lines.push(`| ${col.name} | ${col.type} | ${nullable} | ${attrStr} | ${descStr} |`);
  }

  lines.push('');

  const fkStr =
    rel.foreignKeys.length > 0
      ? rel.foreignKeys.map((f) => `${f.columns.join(', ')} -> ${f.references.relation}`).join('; ')
      : 'none';
  const refStr =
    rel.referencedBy.length > 0
      ? rel.referencedBy.map((r) => `${r.relation}(${r.columns.join(', ')})`).join('; ')
      : 'none';

  lines.push(`- **Foreign Keys:** ${fkStr}`);
  lines.push(`- **Referenced By:** ${refStr}`);

  if (includeHiddenCount && rel.hiddenColumnCount > 0) {
    const s = rel.hiddenColumnCount === 1 ? '' : 's';
    lines.push(`- **Hidden Columns:** ${rel.hiddenColumnCount} column${s} hidden`);
  }

  lines.push('');
  return lines.join('\n');
}

export async function schemaExportCommand(options: SchemaExportOptions = {}): Promise<void> {
  const configPath = options.config ?? './pgmoat.yaml';
  const resolvedPath = path.resolve(process.cwd(), configPath);

  let loaded: ReturnType<typeof loadConfig>;
  try {
    loaded = loadConfig({ path: resolvedPath });
  } catch (err: unknown) {
    exitWithError(err);
  }

  if (loaded.kind === 'none') {
    exitWithError(refuse('PGM-109', `Config file not found at: ${resolvedPath}`));
  }

  const { config } = loaded;
  let pools: ReturnType<typeof createPools> | undefined;

  try {
    pools = createPools(config);
    const rawCatalog = await introspect(pools.query, config.connection.schemas);
    const snapshot = buildSnapshot(rawCatalog, config);

    const lines: string[] = [];
    lines.push(`# Database Schema: ${config.server.name}`);
    lines.push('');
    if (config.server.description) {
      lines.push(config.server.description);
      lines.push('');
    }

    if (options.includeHiddenCount && snapshot.hiddenCount > 0) {
      const s = snapshot.hiddenCount === 1 ? '' : 's';
      lines.push(`*Note: ${snapshot.hiddenCount} relation${s} hidden by configuration.*`);
      lines.push('');
    }

    const relations = [...snapshot.relations].sort((a, b) =>
      a.qualifiedName.localeCompare(b.qualifiedName),
    );

    for (const rel of relations) {
      lines.push(formatRelationMarkdown(rel, Boolean(options.includeHiddenCount)));
    }

    const markdown = lines.join('\n');

    if (options.output) {
      const outputPath = path.resolve(process.cwd(), options.output);
      fs.writeFileSync(outputPath, markdown, 'utf8');
    } else {
      process.stdout.write(markdown + '\n');
    }
  } catch (err: unknown) {
    exitWithError(err);
  } finally {
    if (pools) {
      await pools.end().catch(() => {});
    }
  }
}
