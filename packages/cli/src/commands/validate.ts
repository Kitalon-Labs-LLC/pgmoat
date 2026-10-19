import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import {
  loadConfig,
  createPools,
  introspect,
  buildSnapshot,
  checkAgainstSchema,
  refuse,
} from '@pgmoat/core';
import { ok, yellow } from '../output.js';
import { exitWithError } from '../exit.js';

export interface ValidateOptions {
  config?: string;
  strict?: boolean;
}

export interface ValidationWarning {
  location: string;
  message: string;
}

export async function validateCommand(options: ValidateOptions = {}): Promise<void> {
  const configPath = options.config ?? './pgmoat.yaml';
  const resolvedPath = path.resolve(process.cwd(), configPath);
  const baseName = path.basename(resolvedPath);

  // 1. Load config (errors throw PGM-109 / 1xx -> exits with code 3)
  let loaded: ReturnType<typeof loadConfig>;
  try {
    loaded = loadConfig({
      path: resolvedPath,
      ...(options.strict !== undefined ? { strict: options.strict } : {}),
    });
  } catch (err: unknown) {
    exitWithError(err);
  }

  if (loaded.kind === 'none') {
    exitWithError(refuse('PGM-109', `Config file not found at: ${resolvedPath}`));
  }

  const { config } = loaded;
  ok(`${baseName} is valid  (version ${config.version}, ${config.mode}, ${config.transport})`);

  // 2. Connect to database
  let pools: ReturnType<typeof createPools> | undefined;
  let dbHost = 'localhost';
  let dbPort = 5432;
  let dbName = 'postgres';
  let pgVersion = '17';

  try {
    try {
      const u = new URL(config.connection.url);
      dbHost = u.hostname || 'localhost';
      dbPort = u.port ? parseInt(u.port, 10) : 5432;
      dbName = u.pathname.replace(/^\//, '') || 'postgres';
    } catch {
      // keep defaults
    }

    pools = createPools(config);
    const probeRes = await pools.query.query(
      'SELECT substring(version() from \'PostgreSQL ([0-9.]+)\') AS v',
    );
    if (probeRes.rows[0]?.v) {
      pgVersion = probeRes.rows[0].v;
    }
  } catch {
    if (pools) {
      await pools.end().catch(() => {});
    }
    // Connection error maps to exit code 2
    exitWithError(refuse('PGM-101', `Cannot connect to Postgres at ${dbHost}:${dbPort}`));
  }

  try {
    // 3. Introspect & snapshot
    const rawCatalog = await introspect(pools, config.connection.schemas);
    const snapshot = buildSnapshot(rawCatalog, config);

    // 4. Annotations line lookup in YAML document
    const rawYaml = fs.readFileSync(resolvedPath, 'utf8');
    const lineCounter = new yaml.LineCounter();
    const doc = yaml.parseDocument(rawYaml, { lineCounter });

    const getTableLine = (tableName: string): number => {
      const node = doc.getIn(['tables', tableName], true) as { range?: [number, number, number] } | undefined;
      if (node && Array.isArray(node.range)) {
        return lineCounter.linePos(node.range[0]).line;
      }
      return 1;
    };

    const getColumnLine = (tableName: string, colName: string): number => {
      const node = doc.getIn(['tables', tableName, 'columns', colName], true) as { range?: [number, number, number] } | undefined;
      if (node && Array.isArray(node.range)) {
        return lineCounter.linePos(node.range[0]).line;
      }
      return getTableLine(tableName);
    };

    const warnings: ValidationWarning[] = [];

    // Check descriptions for snapshot relations
    for (const rel of snapshot.relations) {
      const tableKey = config.tables[rel.name] ? rel.name : rel.qualifiedName;
      // eslint-disable-next-line security/detect-object-injection
      const configuredDesc = config.tables[tableKey]?.description;
      if (!configuredDesc || configuredDesc.trim() === '') {
        const line = getTableLine(tableKey);
        warnings.push({
          location: `${baseName}:${line}`,
          message: `${rel.qualifiedName} has no description; the agent will see "Unannotated"`,
        });
      }
    }

    // Check untrusted columns without descriptions
    for (const [tableName, tableAnn] of Object.entries(config.tables)) {
      if (tableAnn.columns) {
        for (const [colName, colAnn] of Object.entries(tableAnn.columns)) {
          if (colAnn.untrusted && (!colAnn.description || colAnn.description.trim() === '')) {
            const line = getColumnLine(tableName, colName);
            warnings.push({
              location: `${baseName}:${line}`,
              message: `${tableName}.${colName} marked untrusted but not described`,
            });
          }
        }
      }
    }

    // Stale annotations checks
    const schemaChecks = checkAgainstSchema(config, snapshot);
    for (const w of schemaChecks.warnings) {
      // Find table/col from message
      const match = /table "([^"]+)"/.exec(w.message);
      const colMatch = /column "([^"]+)" in table "([^"]+)"/.exec(w.message);
      let loc = `${baseName}:1`;
      let text = w.message;
      if (colMatch && colMatch[1] && colMatch[2]) {
        const col = colMatch[1];
        const tbl = colMatch[2];
        loc = `${baseName}:${getColumnLine(tbl, col)}`;
        text = [tbl, '.', col, ': column not found in database (STALE)'].join('');
      } else if (match && match[1]) {
        const tbl = match[1];
        loc = `${baseName}:${getTableLine(tbl)}`;
        text = [tbl, ': table not found in database (STALE)'].join('');
      }
      warnings.push({
        location: loc,
        message: text,
      });
    }

    ok(`Connected  ${dbHost}:${dbPort}/${dbName}  Postgres ${pgVersion}`);
    ok(`Annotations match the database  (${snapshot.relations.length} relations)`);

    if (warnings.length > 0) {
      process.stdout.write('\n');
      const countStr = `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`;
      process.stdout.write(`${countStr}\n`);
      for (const w of warnings) {
        const marker = yellow('!');
        const locPadded = w.location.padEnd(18, ' ');
        process.stdout.write(`  ${marker} ${locPadded} ${w.message}\n`);
      }

      if (options.strict) {
        process.exit(1);
      }
    }
  } finally {
    await pools.end().catch(() => {});
  }
}
