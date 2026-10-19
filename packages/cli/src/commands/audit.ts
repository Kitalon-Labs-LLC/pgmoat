import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {
  pg,
  verifyAuditEntries,
  getDefaultAuditDir,
  type AuditEntry,
  type VerifyReport,
} from '@pgmoat/core';
import { ok, green, yellow, red, isColorEnabled } from '../output.js';
import { exitWithError } from '../exit.js';

export interface AuditFilters {
  since?: Date | undefined;
  until?: Date | undefined;
  tool?: string | undefined;
  status?: string | undefined;
  tenant?: string | undefined;
  principal?: string | undefined;
}

export function parseDuration(str: string): number {
  const match = /^(\d+)([smhd])$/.exec(str);
  if (!match || !match[1] || !match[2]) {
    throw new Error(`Invalid duration string: "${str}". Use format like 1h, 30m, 7d.`);
  }
  const num = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === 's') return num * 1000;
  if (unit === 'm') return num * 60 * 1000;
  if (unit === 'h') return num * 60 * 60 * 1000;
  if (unit === 'd') return num * 24 * 60 * 60 * 1000;
  return num * 1000;
}

export function parseSince(str: string): Date {
  const match = /^(\d+)([smhd])$/.exec(str);
  if (match) {
    const ms = parseDuration(str);
    return new Date(Date.now() - ms);
  }
  const d = new Date(str);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date/time: "${str}"`);
  }
  return d;
}

export function filterEntry(entry: AuditEntry, filters: AuditFilters): boolean {
  if (filters.since) {
    const entryDate = new Date(entry.ts);
    if (entryDate < filters.since) return false;
  }
  if (filters.until) {
    const entryDate = new Date(entry.ts);
    if (entryDate > filters.until) return false;
  }
  if (filters.tool && entry.tool !== filters.tool) {
    return false;
  }
  if (filters.status && entry.status !== filters.status) {
    return false;
  }
  if (filters.principal && entry.principal !== filters.principal) {
    return false;
  }
  if (filters.tenant) {
    const tVal = entry.rls_context ? entry.rls_context[Object.keys(entry.rls_context)[0] ?? ''] : undefined;
    if (tVal !== filters.tenant) return false;
  }
  return true;
}

export async function* readAuditStream(filePath: string): AsyncGenerator<AuditEntry> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as AuditEntry;
      yield parsed;
    } catch {
      // skip invalid lines
    }
  }
}

export function formatTime(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

export function formatTailRow(entry: AuditEntry): string {
  const time = formatTime(entry.ts);
  const shortId = (entry.request_id || entry.instance_id).slice(0, 6) + '..';
  const client = ([entry.client_name, entry.client_version].filter(Boolean).join(' ') || 'local')
    .padEnd(17, ' ')
    .slice(0, 17);
  const princ = (entry.principal || 'local').padEnd(9, ' ').slice(0, 9);
  const tool = entry.tool.padEnd(14, ' ').slice(0, 14);
  const status = entry.status.padEnd(8, ' ');

  let summary = '-'.padEnd(8, ' ');
  if (entry.status === 'success') {
    const rows =
      entry.rows_returned !== null && entry.rows_returned !== undefined
        ? `${entry.rows_returned} row${entry.rows_returned === 1 ? '' : 's'}`
        : '-';
    summary = rows.padEnd(8, ' ');
  } else if (entry.error_code) {
    summary = entry.error_code.padEnd(8, ' ');
  }

  const duration = `${entry.duration_ms} ms`;
  return `${time}  ${shortId}  ${client}  ${princ}  ${tool}  ${status}  ${summary}  ${duration}`;
}

export function formatQueryRow(entry: AuditEntry): string {
  const time = formatTime(entry.ts);
  const shortId = (entry.request_id || entry.instance_id).slice(0, 6) + '..';
  const princ = entry.principal || 'user';
  const tool = entry.tool;
  const code =
    entry.error_code ||
    (entry.rows_returned !== null && entry.rows_returned !== undefined
      ? `${entry.rows_returned} rows`
      : '-');
  const sql = entry.sql_executed ? entry.sql_executed.replace(/\s+/g, ' ').slice(0, 60) : '-';
  return `${shortId}  ${time}  ${princ}  ${tool}  ${code}  ${sql}`;
}

export function renderVerifyHuman(filesCount: number, report: VerifyReport): string {
  const lines: string[] = [];
  const colors = isColorEnabled();

  const fileWord = filesCount === 1 ? 'file' : 'files';
  const instWord = report.instances.length === 1 ? 'instance' : 'instances';
  lines.push(
    `Verifying ${filesCount} ${fileWord}, ${report.instances.length} ${instWord}, ${report.totalEntries.toLocaleString()} entries ...`,
  );

  const okMarker = colors ? green('ok') + ' ' : 'ok ';
  const warnMarker = colors ? yellow('!') + '  ' : '!  ';
  const errMarker = colors ? red('x') + '  ' : 'x  ';

  for (const inst of report.instances) {
    const short = inst.instanceId.slice(0, 6) + '..';
    const seqStr = `seq ${inst.firstSeq}..${inst.lastSeq}`.padEnd(16, ' ');

    if (inst.status === 'intact' && inst.droppedRecorded === 0) {
      lines.push(`${okMarker}instance ${short}  ${seqStr}intact`);
    } else if (inst.droppedRecorded > 0 && inst.status === 'intact') {
      lines.push(
        `${warnMarker}instance ${short}  ${seqStr}${inst.droppedRecorded} dropped entries recorded (buffer overflow)`,
      );
    } else if (inst.status === 'edited') {
      const bad = inst.badSeq !== undefined ? ` at seq ${inst.badSeq}` : '';
      lines.push(`${errMarker}instance ${short}  ${seqStr}hash mismatch${bad} (entry edited or corrupted)`);
    } else {
      const bad = inst.badSeq !== undefined ? ` at seq ${inst.badSeq}` : '';
      lines.push(`${errMarker}instance ${short}  ${seqStr}sequence gap${bad}`);
    }
  }

  lines.push('');
  const failedCount = report.instances.filter((i) => !i.intact).length;
  if (failedCount > 0) {
    lines.push(`Result: ${failedCount} instance${failedCount === 1 ? '' : 's'} failed verification.`);
  } else {
    lines.push('Result: all instances intact.');
  }

  return lines.join('\n');
}

export interface AuditCommandOptions {
  path?: string | undefined;
  format?: 'table' | 'csv' | 'ndjson' | undefined;
  postgres?: boolean | undefined;
  url?: string | undefined;
  since?: string | undefined;
  until?: string | undefined;
  tool?: string | undefined;
  status?: string | undefined;
  tenant?: string | undefined;
  principal?: string | undefined;
  olderThan?: string | undefined;
  dryRun?: boolean | undefined;
  follow?: boolean | undefined;
}

export function rowToAuditEntry(r: Record<string, unknown>): AuditEntry {
  return {
    request_id: String(r.request_id ?? ''),
    instance_id: String(r.instance_id ?? ''),
    seq: Number(r.seq ?? 0),
    ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts ?? ''),
    transport: (r.transport as 'stdio' | 'http') ?? 'stdio',
    protocol_version: r.protocol_version ? String(r.protocol_version) : null,
    client_name: r.client_name ? String(r.client_name) : null,
    client_version: r.client_version ? String(r.client_version) : null,
    principal: String(r.principal ?? ''),
    trace_id: r.trace_id ? String(r.trace_id) : null,
    tool: String(r.tool ?? ''),
    params: typeof r.params === 'string' ? (JSON.parse(r.params) as Record<string, unknown>) : ((r.params as Record<string, unknown>) ?? {}),
    sql_executed: r.sql_executed ? String(r.sql_executed) : null,
    sql_fingerprint: r.sql_fingerprint ? String(r.sql_fingerprint) : null,
    rls_context: typeof r.rls_context === 'string' ? (JSON.parse(r.rls_context) as Record<string, string>) : ((r.rls_context as Record<string, string> | null) ?? null),
    status: (r.status as 'success' | 'refused' | 'error' | 'canceled') ?? 'success',
    error_code: (r.error_code as AuditEntry['error_code']) ?? null,
    error_message: r.error_message ? String(r.error_message) : null,
    warnings: Array.isArray(r.warnings) ? (r.warnings as string[]) : [],
    rows_returned: r.rows_returned !== null && r.rows_returned !== undefined ? Number(r.rows_returned) : null,
    rows_affected: r.rows_affected !== null && r.rows_affected !== undefined ? Number(r.rows_affected) : null,
    duration_ms: Number(r.duration_ms ?? 0),
    budget_max_rows: Number(r.budget_max_rows ?? 0),
    budget_max_query_ms: Number(r.budget_max_query_ms ?? 0),
    payload_bytes: r.payload_bytes !== null && r.payload_bytes !== undefined ? Number(r.payload_bytes) : null,
    prev_hash: String(r.prev_hash ?? ''),
    entry_hash: String(r.entry_hash ?? ''),
    dropped_since_last: Number(r.dropped_since_last ?? 0),
    unsafe_role_override: Boolean(r.unsafe_role_override),
    pgmoat_version: String(r.pgmoat_version ?? ''),
    server_name: String(r.server_name ?? ''),
  };
}

export async function auditCommand(
  subcommand: string,
  rawArgsOrOpts: AuditCommandOptions | string[] = {},
): Promise<void> {
  let opts: AuditCommandOptions;
  if (Array.isArray(rawArgsOrOpts)) {
    const rawArgs = rawArgsOrOpts;
    const getOpt = (name: string): string | undefined => {
      const idx = rawArgs.indexOf(`--${name}`);
      if (idx !== -1 && idx + 1 < rawArgs.length) {
        return rawArgs[idx + 1];
      }
      return undefined;
    };
    const hasFlag = (name: string): boolean => rawArgs.includes(`--${name}`);
    opts = {
      path: getOpt('path'),
      format: (getOpt('format') as 'table' | 'csv' | 'ndjson') ?? 'table',
      postgres: hasFlag('postgres'),
      url: getOpt('url'),
      since: getOpt('since'),
      until: getOpt('until'),
      tool: getOpt('tool'),
      status: getOpt('status'),
      tenant: getOpt('tenant'),
      principal: getOpt('principal'),
      olderThan: getOpt('older-than'),
      dryRun: hasFlag('dry-run'),
      follow: hasFlag('follow'),
    };
  } else {
    opts = rawArgsOrOpts;
  }

  const auditPath = opts.path ?? (fs.existsSync('./pgmoat-audit') ? './pgmoat-audit' : getDefaultAuditDir());
  const format = opts.format ?? 'table';
  const isPostgres = Boolean(opts.postgres);

  if (subcommand === 'verify') {
    if (isPostgres) {
      const url = opts.url ?? process.env.PGMOAT_DATABASE_URL;
      if (!url) {
        exitWithError(new Error('Postgres URL required for --postgres verification'));
      }
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      try {
        const res = await client.query('SELECT * FROM pgmoat.audit ORDER BY seq ASC');
        const entries: AuditEntry[] = res.rows.map(rowToAuditEntry);
        const report = verifyAuditEntries(entries);
        process.stdout.write(renderVerifyHuman(1, report) + '\n');
        if (!report.allIntact) process.exit(1);
      } finally {
        await client.end().catch(() => {});
      }
      return;
    }

    if (!fs.existsSync(auditPath)) {
      exitWithError(new Error(`Audit path does not exist: ${auditPath}`));
    }

    const files = fs
      .readdirSync(auditPath)
      .filter((f) => f.endsWith('.ndjson'))
      .map((f) => path.join(auditPath, f))
      .sort();

    const allEntries: AuditEntry[] = [];
    for (const f of files) {
      for await (const entry of readAuditStream(f)) {
        allEntries.push(entry);
      }
    }

    const report = verifyAuditEntries(allEntries);
    process.stdout.write(renderVerifyHuman(files.length, report) + '\n');
    if (!report.allIntact) {
      process.exit(1);
    }
    return;
  }

  if (subcommand === 'tail' || subcommand === 'query') {
    const filters: AuditFilters = {};
    const sinceStr = opts.since;
    if (sinceStr) filters.since = parseSince(sinceStr);
    const untilStr = opts.until;
    if (untilStr) filters.until = parseSince(untilStr);
    if (opts.tool) filters.tool = opts.tool;
    if (opts.status) filters.status = opts.status;
    if (opts.tenant) filters.tenant = opts.tenant;
    if (opts.principal) filters.principal = opts.principal;

    const matchingEntries: AuditEntry[] = [];

    if (isPostgres) {
      const url = opts.url ?? process.env.PGMOAT_DATABASE_URL;
      if (!url) {
        exitWithError(new Error('Postgres URL required for --postgres query'));
      }
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      try {
        const res = await client.query('SELECT * FROM pgmoat.audit ORDER BY ts DESC LIMIT 1000');
        for (const r of res.rows) {
          const entry = rowToAuditEntry(r);
          if (filterEntry(entry, filters)) {
            matchingEntries.push(entry);
          }
        }
      } finally {
        await client.end().catch(() => {});
      }
    } else {
      if (!fs.existsSync(auditPath)) {
        process.stdout.write(`0 entries found in ${auditPath}\n`);
        return;
      }
      const files = fs
        .readdirSync(auditPath)
        .filter((f) => f.endsWith('.ndjson'))
        .map((f) => path.join(auditPath, f))
        .sort()
        .reverse(); // newest first for tail

      for (const f of files) {
        for await (const entry of readAuditStream(f)) {
          if (filterEntry(entry, filters)) {
            matchingEntries.push(entry);
          }
        }
      }
    }

    if (format === 'ndjson') {
      for (const e of matchingEntries) {
        process.stdout.write(JSON.stringify(e) + '\n');
      }
      return;
    }

    if (format === 'csv') {
      process.stdout.write('ts,request_id,principal,tool,status,error_code,duration_ms\n');
      for (const e of matchingEntries) {
        process.stdout.write(
          `"${e.ts}","${e.request_id}","${e.principal || ''}","${e.tool}","${e.status}","${e.error_code || ''}",${e.duration_ms}\n`,
        );
      }
      return;
    }

    // Default table format
    if (subcommand === 'query') {
      const tenantSuffix = filters.tenant ? ` for tenant ${filters.tenant}` : '';
      const statusPrefix = filters.status ? `${filters.status} ` : '';
      const countHeader = `${matchingEntries.length} ${statusPrefix}calls${tenantSuffix}\n`;
      process.stdout.write(countHeader + '\n');

      for (const e of matchingEntries) {
        process.stdout.write(formatQueryRow(e) + '\n');
      }
      process.stdout.write('\nExport: add --format csv > refused.csv\n');
    } else {
      // tail
      for (const e of matchingEntries) {
        process.stdout.write(formatTailRow(e) + '\n');
      }
      process.stdout.write(
        `${matchingEntries.length} entries. Filter with --tool, --status, --tenant, --principal. Follow with --follow.\n`,
      );
    }
    return;
  }

  if (subcommand === 'prune') {
    const olderThanStr = opts.olderThan ?? '30d';
    const olderThanMs = parseDuration(olderThanStr);
    const thresholdDate = new Date(Date.now() - olderThanMs);
    const isDryRun = Boolean(opts.dryRun);

    if (!fs.existsSync(auditPath)) {
      process.stdout.write(`Audit directory not found: ${auditPath}\n`);
      return;
    }

    const files = fs
      .readdirSync(auditPath)
      .filter((f) => f.endsWith('.ndjson'))
      .map((f) => path.join(auditPath, f));

    const prunedFiles: string[] = [];
    for (const f of files) {
      const stat = fs.statSync(f);
      if (stat.mtime < thresholdDate) {
        prunedFiles.push(f);
        if (!isDryRun) {
          fs.unlinkSync(f);
        }
      }
    }

    if (isDryRun) {
      process.stdout.write(`Dry run: ${prunedFiles.length} file(s) would be pruned:\n`);
      for (const pf of prunedFiles) {
        process.stdout.write(`  ${pf}\n`);
      }
    } else {
      ok(`Pruned ${prunedFiles.length} file(s)`);
    }
    return;
  }

  exitWithError(new Error(`Unknown audit subcommand: "${subcommand}". Use tail | query | verify | prune.`));
}
