import { PGMOAT_VERSION } from './version.js';
import type { Runtime } from './runtime.js';

export interface ZeroConfigNoticeOptions {
  readonly fromArgvPassword?: boolean;
}

/**
 * Formats the canonical zero-config startup banner per spec/06 section 2.4.
 */
export function formatZeroConfigNotice(
  runtime: Runtime,
  options?: ZeroConfigNoticeOptions,
): string {
  const { config, schemaCache, doctorFindings } = runtime;
  const snapshot = schemaCache.get();

  // Database host:port/dbname
  let dbTarget = 'database';
  try {
    const parsed = new URL(config.connection.url);
    const host = parsed.hostname || 'localhost';
    const port = parsed.port || '5432';
    const dbName = parsed.pathname.replace(/^\//, '') || 'postgres';
    dbTarget = `${host}:${port}/${dbName}`;
  } catch {
    dbTarget = config.connection.url;
  }

  const role = runtime.currentUser || 'unknown';
  let pgVer = '';
  if (snapshot.serverVersionNum) {
    const major = Math.floor(snapshot.serverVersionNum / 10000);
    const minor = snapshot.serverVersionNum % 100;
    pgVer = ` (Postgres ${major}.${minor})`;
  }

  // Count relations
  const tables = snapshot.relations.filter(
    (r) => r.kind === 'table' || r.kind === 'partitioned_table',
  );
  const views = snapshot.relations.filter(
    (r) => r.kind === 'view' || r.kind === 'materialized_view',
  );
  const schemaList = config.connection.schemas.join(', ');

  // Budgets
  const rows = config.budgets.max_rows;
  const ms = config.budgets.max_query_ms;
  const kb = Math.round(config.budgets.max_payload_bytes / 1024);

  // Audit
  let auditStr: string;
  if (config.audit.destination === 'file') {
    auditStr = config.audit.path ?? 'per-user state directory';
  } else if (config.audit.destination === 'postgres') {
    auditStr = [
      'postgres target ',
      config.audit.postgres.schema,
      '.',
      config.audit.postgres.table,
    ].join('');
  } else {
    auditStr = config.audit.destination;
  }

  const lines = [
    `pgmoat ${PGMOAT_VERSION}  zero-config  ${config.mode}  ${config.transport}`,
    `database   ${dbTarget}${pgVer}, role ${role}`,
    `schema     ${tables.length} tables, ${views.length} views in ${schemaList}`,
    `budgets    ${rows} rows, ${ms} ms, ${kb} KB per result`,
    `audit      ${auditStr}`,
  ];

  if (doctorFindings.length > 0) {
    const finding = doctorFindings[0]!;
    lines.push(`doctor     ! ${finding.code} ${finding.message}`);
  }

  lines.push('next       run `npx pgmoat init` to add descriptions and hide sensitive columns');

  if (options?.fromArgvPassword) {
    lines.push('!          the connection URL is visible in process listings; prefer --url-env PGMOAT_DATABASE_URL');
  }

  return lines.join('\n') + '\n';
}

/**
 * Prints the zero-config startup banner to stderr.
 */
export function printZeroConfigNotice(
  runtime: Runtime,
  options?: ZeroConfigNoticeOptions,
): void {
  process.stderr.write(formatZeroConfigNotice(runtime, options));
}
