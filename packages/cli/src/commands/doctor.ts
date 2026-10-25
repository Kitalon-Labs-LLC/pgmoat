import path from 'node:path';
import {
  loadConfig,
  createPools,
  introspect,
  runDoctor,
  refuse,
  type DoctorFinding,
} from '@pgmoat/core';
import { isJson, green, yellow, red, isColorEnabled } from '../output.js';
import { exitWithError } from '../exit.js';

export interface DoctorOptions {
  config?: string;
  strict?: boolean;
}

export interface DoctorCheckItem {
  code: string;
  status: 'ok' | 'warn' | 'fail' | 'info';
  summary: string;
  finding?: DoctorFinding | undefined;
}

export interface DoctorReport {
  currentUser: string;
  host: string;
  port: number;
  database: string;
  pgVersion: string;
  checks: DoctorCheckItem[];
  failuresCount: number;
  warningsCount: number;
}

export function buildDoctorReport(
  currentUser: string,
  host: string,
  port: number,
  database: string,
  pgVersion: string,
  protectedTables: string[],
  findings: DoctorFinding[],
): DoctorReport {
  const findingsByCode = new Map<string, DoctorFinding>();
  for (const f of findings) {
    findingsByCode.set(f.code, f);
  }

  const checks: DoctorCheckItem[] = [];

  // PGM-701
  const f701 = findingsByCode.get('PGM-701');
  checks.push({
    code: 'PGM-701',
    status: f701 ? f701.severity : 'ok',
    summary: f701 ? f701.message : 'not a superuser',
    finding: f701,
  });

  // PGM-702
  const f702 = findingsByCode.get('PGM-702');
  checks.push({
    code: 'PGM-702',
    status: f702 ? f702.severity : 'ok',
    summary: f702 ? f702.message : 'no BYPASSRLS',
    finding: f702,
  });

  // PGM-703
  const f703 = findingsByCode.get('PGM-703');
  const protTablesSuffix =
    protectedTables.length > 0 ? ` (${protectedTables.join(', ')})` : '';
  checks.push({
    code: 'PGM-703',
    status: f703 ? f703.severity : 'ok',
    summary: f703 ? f703.message : `does not own protected tables${protTablesSuffix}`,
    finding: f703,
  });

  // PGM-704
  const f704 = findingsByCode.get('PGM-704');
  checks.push({
    code: 'PGM-704',
    status: f704 ? f704.severity : 'ok',
    summary: f704 ? f704.message : 'RLS enabled on all protected tables',
    finding: f704,
  });

  // PGM-705
  const f705 = findingsByCode.get('PGM-705');
  checks.push({
    code: 'PGM-705',
    status: f705 ? f705.severity : 'ok',
    summary: f705 ? f705.message : 'no SELECT access to hidden columns',
    finding: f705,
  });

  // PGM-706
  const f706 = findingsByCode.get('PGM-706');
  checks.push({
    code: 'PGM-706',
    status: f706 ? f706.severity : 'ok',
    summary: f706 ? f706.message : 'no write privileges',
    finding: f706,
  });

  // PGM-707
  const f707 = findingsByCode.get('PGM-707');
  const majorVer = pgVersion.split('.')[0] ?? '17';
  checks.push({
    code: 'PGM-707',
    status: f707 ? f707.severity : 'ok',
    summary: f707 ? f707.message : `Postgres ${majorVer} is supported`,
    finding: f707,
  });

  const failuresCount = findings.filter((f) => f.severity === 'fail').length;
  const warningsCount = findings.filter((f) => f.severity === 'warn' || f.severity === 'info').length;

  return {
    currentUser,
    host,
    port,
    database,
    pgVersion,
    checks,
    failuresCount,
    warningsCount,
  };
}

export function renderDoctorHuman(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push(
    `pgmoat doctor  role ${report.currentUser} on ${report.host}:${report.port}/${report.database} (Postgres ${report.pgVersion})`,
  );
  lines.push('');

  const colors = isColorEnabled();

  for (const check of report.checks) {
    let marker: string;
    if (check.status === 'ok') {
      marker = colors ? green('ok') : 'ok';
    } else if (check.status === 'fail') {
      marker = colors ? red('x ') : 'x ';
    } else {
      marker = colors ? yellow('! ') : '! ';
    }

    lines.push(`${marker} ${check.code}  ${check.summary}`);
    if (check.finding?.fix) {
      const fixLines = check.finding.fix.split('\n');
      for (const fl of fixLines) {
        lines.push(`     ${fl}`);
      }
    }
  }

  lines.push('');
  const failWord = report.failuresCount === 1 ? 'failure' : 'failures';
  const warnWord = report.warningsCount === 1 ? 'warning' : 'warnings';
  lines.push(`Result: ${report.failuresCount} ${failWord}, ${report.warningsCount} ${warnWord}.`);

  return lines.join('\n');
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<void> {
  const configPath = options.config ?? './pgmoat.yaml';
  const resolvedPath = path.resolve(process.cwd(), configPath);

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
    exitWithError(refuse('PGM-109', `Config file not found at: ${resolvedPath}. Run 'pgmoat init' to create one, or start with 'pgmoat <postgres-url>'.`));
  }

  const { config } = loaded;
  let pools: ReturnType<typeof createPools> | undefined;

  let dbHost = 'localhost';
  let dbPort = 5432;
  let dbName = 'postgres';
  let pgVersion = '17.6';
  let currentUser = 'readonly_agent';

  try {
    const u = new URL(config.connection.url);
    dbHost = u.hostname || 'localhost';
    dbPort = u.port ? parseInt(u.port, 10) : 5432;
    dbName = u.pathname.replace(/^\//, '') || 'postgres';
  } catch {
    // defaults
  }

  try {
    pools = createPools(config);
    const probeRes = await pools.query.query(
      'SELECT current_user AS u, substring(version() from \'PostgreSQL ([0-9.]+)\') AS v',
    );
    if (probeRes.rows[0]) {
      currentUser = probeRes.rows[0].u ?? currentUser;
      pgVersion = probeRes.rows[0].v ?? pgVersion;
    }
  } catch {
    if (pools) {
      await pools.end().catch(() => {});
    }
    exitWithError(refuse('PGM-101', `Cannot connect to Postgres at ${dbHost}:${dbPort}`));
  }

  try {
    const introspection = await introspect(pools, config.connection.schemas);
    const findings = await runDoctor(pools, config, introspection);

    const report = buildDoctorReport(
      currentUser,
      dbHost,
      dbPort,
      dbName,
      pgVersion,
      config.rls.protected_tables,
      findings,
    );

    if (isJson()) {
      process.stdout.write(JSON.stringify(report) + '\n');
    } else {
      process.stdout.write(renderDoctorHuman(report) + '\n');
    }

    if (report.failuresCount > 0) {
      process.exit(1);
    }
    if (options.strict && report.warningsCount > 0) {
      process.exit(1);
    }
  } finally {
    await pools.end().catch(() => {});
  }
}
