import { isPgmoatError, type ErrorCode, ERROR_CODES } from '@pgmoat/core';

export interface OutputConfig {
  json?: boolean;
  noColor?: boolean;
}

let globalConfig: OutputConfig = {};

export function configureOutput(options: OutputConfig): void {
  globalConfig = { ...globalConfig, ...options };
}

export function resetOutputConfig(): void {
  globalConfig = {};
}

export function isJson(): boolean {
  return Boolean(globalConfig.json || process.argv.includes('--json'));
}

export function isColorEnabled(): boolean {
  if (globalConfig.noColor) return false;
  if (process.argv.includes('--no-color')) return false;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  return Boolean(process.stdout?.isTTY || process.stderr?.isTTY);
}

// ANSI colors
export function color(code: number, str: string): string {
  if (!isColorEnabled()) return str;
  return `\x1b[${code}m${str}\x1b[0m`;
}

export const green = (str: string): string => color(32, str);
export const yellow = (str: string): string => color(33, str);
export const red = (str: string): string => color(31, str);
export const dim = (str: string): string => color(90, str);
export const cyan = (str: string): string => color(36, str);
export const bold = (str: string): string => color(1, str);

export function ok(message: string): void {
  if (isJson()) {
    process.stdout.write(JSON.stringify({ level: 'info', status: 'ok', message }) + '\n');
  } else {
    process.stdout.write(`${green('ok')} ${message}\n`);
  }
}

export function warn(message: string, fix?: string): void {
  if (isJson()) {
    process.stderr.write(
      JSON.stringify({
        level: 'warn',
        message,
        ...(fix ? { fix } : {}),
      }) + '\n',
    );
  } else {
    process.stderr.write(`${yellow('!')} ${message}\n`);
    if (fix) {
      process.stderr.write(`  Fix: ${fix}\n`);
    }
  }
}

export interface ErrorJsonPayload {
  level: 'error';
  code: string;
  title: string;
  details?: Record<string, unknown>;
  fix?: string;
  docs: string;
}

export function formatError(
  error: unknown,
  details?: Record<string, unknown>,
  options?: OutputConfig,
): string {
  const jsonMode = options?.json ?? isJson();
  const colorEnabled = options?.noColor ? false : isColorEnabled();

  let code: string;
  let title: string;
  let fix: string | undefined;
  let docsUrl: string;

  if (isPgmoatError(error)) {
    code = error.code;
    const def = ERROR_CODES[error.code as ErrorCode];
    title = error.message || def?.title || '';
    fix = error.hint ?? def?.fix;
    docsUrl = error.docsUrl;
  } else if (error instanceof Error) {
    code = 'PGM-501';
    title = error.message;
    fix = undefined;
    docsUrl = `https://pgmoat.dev/docs/errors/${code}`;
  } else {
    code = 'PGM-501';
    title = String(error);
    fix = undefined;
    docsUrl = `https://pgmoat.dev/docs/errors/${code}`;
  }

  if (jsonMode) {
    const payload: ErrorJsonPayload = {
      level: 'error',
      code,
      title,
      ...(details && Object.keys(details).length > 0 ? { details } : {}),
      ...(fix ? { fix } : {}),
      docs: docsUrl,
    };
    return JSON.stringify(payload);
  }

  // Spec 2.3 format:
  // x PGM-201  Write statements are not allowed in read-only mode
  //
  //   Statement:  DeleteStmt
  //   SQL:        DELETE FROM users WHERE id = 'abc'
  //   Mode:       read-only
  //
  //   Fix: pgmoat only runs SELECT, SHOW, and plan-only EXPLAIN in read-only mode.
  //        Scoped writes arrive in v1.1.
  //
  //   https://pgmoat.dev/docs/errors/PGM-201

  const marker = colorEnabled ? '\x1b[31mx\x1b[0m' : 'x';
  const lines: string[] = [];
  lines.push(`${marker} ${code}  ${title}`);

  if (details && Object.keys(details).length > 0) {
    lines.push('');
    const entries = Object.entries(details);
    const maxKeyLen = Math.max(
      ...entries.map(([k]) => (k.toLowerCase() === 'sql' ? 3 : k.length)),
    );
    for (const [key, val] of entries) {
      const formattedKey =
        key.toLowerCase() === 'sql'
          ? 'SQL'
          : key.charAt(0).toUpperCase() + key.slice(1);
      const label = `${formattedKey}:`.padEnd(maxKeyLen + 3, ' ');
      lines.push(`  ${label}${String(val)}`);
    }
  }

  if (fix) {
    lines.push('');
    const [firstLine, ...restLines] = fix.split('\n');
    lines.push(`  Fix: ${firstLine}`);
    for (const line of restLines) {
      lines.push(`       ${line}`);
    }
  }

  lines.push('');
  lines.push(`  ${docsUrl}`);

  return lines.join('\n');
}

export function err(error: unknown, details?: Record<string, unknown>): void {
  process.stderr.write(formatError(error, details) + '\n');
}
