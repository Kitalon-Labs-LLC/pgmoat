import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import {
  createPools,
  introspect,
  buildSnapshot,
  buildZeroConfig,
  runDoctor,
  refuse,
} from '@pgmoat/core';
import { renderYaml, AUTO_HIDE_REGEX, type RenderRelationInput } from '../init/render-yaml.js';
import { mergeYaml } from '../init/merge.js';
import { ok, red, yellow } from '../output.js';
import { exitWithError } from '../exit.js';

export interface InitOptions {
  url?: string;
  urlEnv?: string;
  out?: string;
  merge?: boolean;
  yes?: boolean;
  includeSystem?: boolean;
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
  const outDir = options.out ? path.resolve(process.cwd(), options.out) : process.cwd();
  const targetYamlPath = path.join(outDir, 'pgmoat.yaml');
  const fileExists = fs.existsSync(targetYamlPath);

  let isMerge = Boolean(options.merge);

  if (fileExists) {
    if (!options.merge) {
      if (options.yes) {
        // Spec 02 F2: existing file without --merge and --yes aborts
        process.stderr.write('pgmoat.yaml already exists. Use --merge to update or remove the file.\n');
        process.exit(1);
      }

      // Prompt user
      const action = await p.select({
        message: 'pgmoat.yaml already exists. What should init do?',
        options: [
          { label: 'Abort', value: 'abort' },
          { label: 'Merge', value: 'merge' },
          { label: 'Overwrite', value: 'overwrite' },
        ],
        initialValue: 'abort',
      });

      if (p.isCancel(action) || action === 'abort') {
        p.cancel('Operation aborted.');
        process.exit(1);
      } else if (action === 'merge') {
        isMerge = true;
      }
    }
  }

  // 1. Resolve DB Connection
  let rawUrl = options.url;
  let urlDisplay = options.url ?? (options.urlEnv ? `\${${options.urlEnv}}` : '${PGMOAT_DATABASE_URL}');

  if (!rawUrl && options.urlEnv) {
    rawUrl = process.env[options.urlEnv];
  }

  if (!rawUrl && !options.yes) {
    const defaultConn = process.env.PGMOAT_DATABASE_URL ? '${PGMOAT_DATABASE_URL}' : '';
    const connInput = await p.text({
      message: 'Postgres connection (URL or ${ENV_VAR})',
      placeholder: defaultConn || 'postgresql://user:pass@localhost:5432/db',
      defaultValue: defaultConn,
    });

    if (p.isCancel(connInput)) {
      p.cancel('Init cancelled.');
      process.exit(1);
    }

    if (connInput.startsWith('${') && connInput.endsWith('}')) {
      const varName = connInput.slice(2, -1);
      urlDisplay = connInput;
      // eslint-disable-next-line security/detect-object-injection
      rawUrl = process.env[varName];
      if (!rawUrl) {
        exitWithError(refuse('PGM-109', 'Environment variable ' + varName + ' is not defined'));
      }
    } else if (connInput) {
      rawUrl = connInput;
      urlDisplay = connInput;
    }
  } else if (!rawUrl) {
    rawUrl = process.env.PGMOAT_DATABASE_URL;
  }

  if (!rawUrl) {
    exitWithError(
      refuse(
        'PGM-101',
        'No database URL provided. Set PGMOAT_DATABASE_URL or use --url <url>',
      ),
    );
  }

  // 2. Connect and probe
  let dbHost = 'localhost';
  let dbPort = 5432;
  let dbName = 'postgres';
  try {
    const u = new URL(rawUrl);
    dbHost = u.hostname || 'localhost';
    dbPort = u.port ? parseInt(u.port, 10) : 5432;
    dbName = u.pathname.replace(/^\//, '') || 'postgres';
  } catch {
    // keep defaults
  }

  // Build minimal temp config for pooling
  const tempConfig = buildZeroConfig(rawUrl);

  let pools: ReturnType<typeof createPools> | undefined;
  let currentUser = 'readonly_agent';
  let pgVersion = '17.6';

  try {
    pools = createPools(tempConfig);
    const probeRes = await pools.query.query(
      'SELECT current_user AS u, substring(version() from \'PostgreSQL ([0-9.]+)\') AS v',
    );
    if (probeRes.rows[0]) {
      currentUser = probeRes.rows[0].u ?? currentUser;
      pgVersion = probeRes.rows[0].v ?? pgVersion;
    }
    process.stdout.write(
      `  Connecting to ${dbHost}:${dbPort}/${dbName} ... ok  (Postgres ${pgVersion}, role ${currentUser})\n`,
    );
  } catch {
    if (pools) await pools.end().catch(() => {});
    exitWithError(refuse('PGM-101', `Cannot connect to Postgres at ${dbHost}:${dbPort}`));
  }

  // 3. Introspect schema
  const exposedSchemas = ['public'];
  const rawCatalog = await introspect(pools, exposedSchemas);
  const snapshot = buildSnapshot(rawCatalog, tempConfig);

  // Group relations for rendering
  const renderRelations: RenderRelationInput[] = [];
  let totalColumns = 0;
  let autoHiddenColumnsCount = 0;
  const hiddenColNames: string[] = [];

  for (const rel of snapshot.relations) {
    const cols = rel.columns.map((c) => {
      totalColumns++;
      const isSecret = AUTO_HIDE_REGEX.test(c.name);
      if (isSecret) {
        autoHiddenColumnsCount++;
        hiddenColNames.push(`${rel.name}.${c.name}`);
      }
      return {
        name: c.name,
        comment: c.description ?? null,
        hidden: isSecret,
      };
    });

    renderRelations.push({
      name: rel.name,
      schema: rel.schema,
      comment: rel.description ?? null,
      columns: cols,
    });
  }

  process.stdout.write(
    `  Reading schema ... ok  (${exposedSchemas.length} schemas, ${renderRelations.length} relations, ${totalColumns} columns)\n\n`,
  );

  // 4. Prompts for Server Metadata (if not --yes)
  const defaultServerName = path.basename(outDir).toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'app';
  let serverName = defaultServerName;
  let description = '';
  let transport: 'stdio' | 'http' = 'stdio';
  let auditDest: 'file' | 'stderr' | 'postgres' = 'file';

  if (!options.yes) {
    const nameInput = await p.text({
      message: 'Server name shown in your MCP client',
      defaultValue: defaultServerName,
      placeholder: defaultServerName,
    });
    if (!p.isCancel(nameInput) && nameInput) serverName = nameInput;

    const descInput = await p.text({
      message: 'One-line description',
      defaultValue: '',
      placeholder: 'Database access for AI agent',
    });
    if (!p.isCancel(descInput) && descInput) description = descInput;

    const transportInput = await p.select({
      message: 'Transport',
      options: [
        { label: 'stdio', value: 'stdio' },
        { label: 'http', value: 'http' },
      ],
      initialValue: 'stdio',
    });
    if (!p.isCancel(transportInput)) transport = transportInput as 'stdio' | 'http';

    const auditInput = await p.select({
      message: 'Audit destination',
      options: [
        { label: 'file', value: 'file' },
        { label: 'stderr', value: 'stderr' },
        { label: 'postgres', value: 'postgres' },
      ],
      initialValue: 'file',
    });
    if (!p.isCancel(auditInput)) auditDest = auditInput as 'file' | 'stderr' | 'postgres';
  }

  // 5. Run doctor preflight checks
  const doctorFindings = await runDoctor(pools, tempConfig, rawCatalog);
  await pools.end().catch(() => {});

  if (doctorFindings.length > 0) {
    process.stdout.write('\n  Checking the database role ...\n');
    for (const f of doctorFindings) {
      const marker = f.severity === 'fail' ? red('x') : yellow('!');
      process.stdout.write(`  ${marker} ${f.code}  ${f.message}\n`);
      if (f.fix) {
        process.stdout.write(`     Fix: ${f.fix.split('\n')[0]}\n`);
      }
    }
    process.stdout.write('\n');
  }

  // 6. Write or Merge config
  if (isMerge && fileExists) {
    const existingYaml = fs.readFileSync(targetYamlPath, 'utf8');
    const mergeRes = mergeYaml(existingYaml, renderRelations, { autoHideSecrets: true });
    fs.writeFileSync(targetYamlPath, mergeRes.yaml, 'utf8');

    process.stdout.write(`  Kept ${mergeRes.stats.keptDescriptions} descriptions and ${mergeRes.stats.keptHiddenColumns} hidden columns.\n`);
    process.stdout.write(`  Added ${mergeRes.stats.addedTables} tables and ${mergeRes.stats.addedColumns} columns.\n`);
    if (mergeRes.stats.staleTables > 0) {
      process.stdout.write(
        ['  Marked ', String(mergeRes.stats.staleTables), ' table as STALE (not found in database).\n'].join(''),
      );
    }
    ok('Updated pgmoat.yaml');
  } else {
    const generatedYaml = renderYaml({
      serverName,
      description,
      connectionUrl: urlDisplay,
      schemas: exposedSchemas,
      transport,
      auditDestination: auditDest,
      relations: renderRelations,
    });

    fs.writeFileSync(targetYamlPath, generatedYaml, 'utf8');
    const descToFill = renderRelations.filter((r) => !r.comment).length;
    ok(
      `Wrote pgmoat.yaml  (${renderRelations.length} relations, ${autoHiddenColumnsCount} hidden columns, ${descToFill} descriptions to fill in)`,
    );
  }

  // 7. Update .gitignore if file audit
  if (auditDest === 'file') {
    const gitignorePath = path.join(outDir, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
      if (!gitignoreContent.includes('pgmoat-audit')) {
        fs.appendFileSync(gitignorePath, '\npgmoat-audit/\n', 'utf8');
        ok('Added pgmoat-audit/ to .gitignore');
      }
    }
  }

  // 8. Next steps & client config snippets
  process.stdout.write(renderClientSnippets(serverName, targetYamlPath, rawUrl) + '\n');
}

export function renderClientSnippets(
  serverName: string,
  targetYamlPath: string,
  rawUrl: string,
): string {
  return [
    '',
    'Next steps',
    '  1. Fill in table descriptions in pgmoat.yaml. Your agent reads them.',
    '  2. Run `pgmoat doctor` and apply the suggested REVOKE statements.',
    '  3. Add pgmoat to your client:',
    '',
    '     Claude Code',
    `       claude mcp add ${serverName} -- npx -y pgmoat start --config ${targetYamlPath}`,
    '',
    '     Claude Desktop, Cursor, VS Code (JSON config)',
    `       "${serverName}": {`,
    '         "command": "npx",',
    `         "args": ["-y", "pgmoat", "start", "--config", "${targetYamlPath}"],`,
    `         "env": { "PGMOAT_DATABASE_URL": "${rawUrl}" }`,
    '       }',
    '',
    'https://kitalonlabs.com/pgmoat/docs/quickstart',
  ].join('\n');
}
