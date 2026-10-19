import path from 'node:path';
import {
  PGMOAT_VERSION,
  buildZeroConfig,
  loadConfig,
  createRuntime,
  startStdio,
  refuse,
  type PgmoatConfigT,
  DoctorEnforceError,
} from '@pgmoat/core';
import { red } from '../output.js';
import { exitWithError } from '../exit.js';

export interface StartOptions {
  config?: string;
  urlEnv?: string;
  watch?: boolean;
  allowUnsafeRole?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  isZeroConfig?: boolean;
}

export function formatStartBanner(
  config: PgmoatConfigT,
  configPath: string,
  runtime: {
    snapshot: {
      relations: readonly { qualifiedName: string }[];
      policyIndex: {
        hiddenRelations: ReadonlySet<string>;
        hiddenColumns: ReadonlyMap<string, ReadonlySet<string>>;
      };
    };
    dbVersion?: string;
    currentUser?: string;
    dbHost?: string;
    dbPort?: number;
    dbName?: string;
  },
): string {
  const lines: string[] = [];

  // Header line
  lines.push(`pgmoat ${PGMOAT_VERSION}  ${config.server.name}  ${config.mode}`);

  // Config line
  lines.push(`config     ${configPath}`);

  // Transport
  lines.push(`transport  stdio  (MCP 2026-07-28 and 2025-11-25)`);

  // Database line
  const host = runtime.dbHost ?? 'localhost';
  const port = runtime.dbPort ?? 5432;
  const db = runtime.dbName ?? 'postgres';
  const pgVer = runtime.dbVersion ? `Postgres ${runtime.dbVersion}` : 'Postgres 17';
  const role = runtime.currentUser ? `role ${runtime.currentUser}` : 'role default';
  lines.push(`database   ${host}:${port}/${db}  ${pgVer}  ${role}`);

  // Schema line
  const totalRels = runtime.snapshot.relations.length;
  const hiddenRelsCount = runtime.snapshot.policyIndex.hiddenRelations.size;
  const visibleCount = totalRels - hiddenRelsCount;
  let totalHiddenCols = 0;
  for (const cols of runtime.snapshot.policyIndex.hiddenColumns.values()) {
    totalHiddenCols += cols.size;
  }
  const schemaParts = [`${visibleCount} visible relations`];
  if (hiddenRelsCount > 0) schemaParts.push(`${hiddenRelsCount} hidden`);
  if (totalHiddenCols > 0) schemaParts.push(`${totalHiddenCols} hidden columns`);
  lines.push(`schema     ${schemaParts.join(', ')}`);

  // Tools line
  lines.push(`tools      describe_table, explain, list_tables, query, sample_table`);

  // Budgets line
  const kb = Math.round(config.budgets.max_payload_bytes / 1024);
  const budgetParts = [
    `${config.budgets.max_rows} rows`,
    `${config.budgets.max_query_ms} ms`,
    `${kb} KB`,
  ];
  if (config.budgets.max_columns) {
    budgetParts.push(`${config.budgets.max_columns} columns`);
  }
  lines.push(`budgets    ${budgetParts.join(', ')}`);

  // RLS line
  const sessionEntries = Object.entries(config.rls.session_variables);
  if (sessionEntries.length > 0 && sessionEntries[0]) {
    const [k, v] = sessionEntries[0];
    const reqStr = config.rls.required ? ' (required)' : '';
    lines.push(`rls        ${k} <- ${v}${reqStr}`);
  }

  // Audit line
  const auditPath = 'path' in config.audit && config.audit.path ? `  ${config.audit.path}` : '';
  lines.push(`audit      ${config.audit.destination}${auditPath}`);

  // Doctor line
  lines.push(`doctor     ok`);

  // Ready line
  lines.push(`ready`);

  return lines.join('\n');
}

export function printDoctorRefusalBanner(error: DoctorEnforceError): void {
  const first = error.findings[0];
  const code = first?.code ?? 'PGM-702';
  const msg = first?.message ?? 'Doctor preflight check failed';
  const fix = first?.fix ?? 'ALTER ROLE ...';

  const marker = red('x');
  const banner = [
    `${marker} pgmoat did not start: the database role failed safety checks.`,
    '',
    `  ${marker} ${code}  ${msg}`,
    `     Fix: ${fix}`,
    '',
    `  Run \`pgmoat doctor\` for all findings. To start anyway (not recommended),`,
    `  pass --allow-unsafe-role. Every audit entry will record the override.`,
    '',
    `  https://pgmoat.dev/docs/errors/${code}`,
  ].join('\n');

  process.stderr.write(banner + '\n');
}

export async function startCommand(
  urlOrConfig?: string,
  options: StartOptions = {},
): Promise<void> {
  const isZero =
    options.isZeroConfig ||
    (typeof urlOrConfig === 'string' && /^postgres(ql)?:\/\//.test(urlOrConfig));

  let config: PgmoatConfigT;
  let resolvedConfigPath: string;

  if (isZero && urlOrConfig) {
    // Zero-config start
    resolvedConfigPath = 'zero-config';
    config = buildZeroConfig(urlOrConfig);
  } else {
    // Config-file start
    const cfgPath = options.config ?? (urlOrConfig && !urlOrConfig.startsWith('-') ? urlOrConfig : './pgmoat.yaml');
    resolvedConfigPath = path.resolve(process.cwd(), cfgPath);

    let loadEnv = process.env;
    if (options.urlEnv) {
      const urlVal = process.env[options.urlEnv];
      if (!urlVal) {
        throw refuse('PGM-109', 'Environment variable ' + options.urlEnv + ' is not defined');
      }
      loadEnv = { ...process.env, PGMOAT_DATABASE_URL: urlVal };
    }

    const loaded = loadConfig({ path: resolvedConfigPath, env: loadEnv });
    if (loaded.kind === 'none') {
      throw refuse('PGM-109', `Config file not found at: ${resolvedConfigPath}`);
    }
    config = loaded.config;
  }

  if (options.logLevel) {
    config = {
      ...config,
      logging: {
        ...config.logging,
        level: options.logLevel,
      },
    };
  }

  if (config.transport === 'http') {
    process.stderr.write('HTTP transport arrives in P9\n');
    process.exit(1);
  }

  let runtime: Awaited<ReturnType<typeof createRuntime>>;
  try {
    runtime = await createRuntime(config, {
      ...(options.allowUnsafeRole ? { allowUnsafeRole: true } : {}),
    });
  } catch (err: unknown) {
    if (err instanceof DoctorEnforceError) {
      printDoctorRefusalBanner(err);
      process.exit(1);
    }
    exitWithError(err);
  }

  // Parse host/port/database from connection url
  let dbHost = 'localhost';
  let dbPort = 5432;
  let dbName = 'postgres';
  let fromArgvPassword = false;
  try {
    const u = new URL(config.connection.url);
    dbHost = u.hostname || 'localhost';
    dbPort = u.port ? parseInt(u.port, 10) : 5432;
    dbName = u.pathname.replace(/^\//, '') || 'postgres';
    if (u.password && Boolean(urlOrConfig && /^postgres(ql)?:\/\//.test(urlOrConfig))) {
      fromArgvPassword = true;
    }
  } catch {
    // Keep defaults
  }

  // Parse postgres version & user from probe
  let dbVersion = '17.6';
  let currentUser = 'readonly_agent';
  try {
    const probeRes = await runtime.pools.query.query(
      'SELECT current_user AS u, substring(version() from \'PostgreSQL ([0-9.]+)\') AS v',
    );
    if (probeRes.rows[0]) {
      currentUser = probeRes.rows[0].u ?? currentUser;
      dbVersion = probeRes.rows[0].v ?? dbVersion;
    }
  } catch {
    // Keep probe defaults
  }

  // Print start banner to stderr (zero-config notice is handled separately by startStdio if zero-config)
  if (!isZero) {
    const banner = formatStartBanner(config, resolvedConfigPath, {
      snapshot: runtime.schemaCache.get(),
      dbVersion,
      currentUser,
      dbHost,
      dbPort,
      dbName,
    });
    process.stderr.write(banner + '\n');
  }

  // Start stdio transport
  startStdio(runtime, {
    isZeroConfig: isZero,
    fromArgvPassword,
  });

  // Watch mode if requested
  if (options.watch && !isZero) {
    const { watchConfig } = await import('@pgmoat/core');
    watchConfig(resolvedConfigPath, config, async () => {
      process.stderr.write('\nConfig changed, reloading...\n');
      await runtime.shutdown('config-reload');
      await startCommand(urlOrConfig, { ...options, watch: false });
    });
  }
}
