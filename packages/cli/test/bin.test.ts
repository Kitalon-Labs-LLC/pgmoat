import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HELP_TEXT, detectZeroConfig, runCli } from '../src/bin.js';
import { getExitCode, EXIT_SUCCESS, EXIT_USER_ERROR, EXIT_CONNECTION_ERROR, EXIT_CONFIG_ERROR } from '../src/exit.js';
import { formatError, resetOutputConfig } from '../src/output.js';
import { getVersionInfo } from '../src/commands/version.js';
import { refuse, fail, PgmoatError } from '@pgmoat/core';

describe('CLI bin & entry (P8.1)', () => {
  beforeEach(() => {
    resetOutputConfig();
  });

  afterEach(() => {
    resetOutputConfig();
  });

  it('matches exact help text from spec/06 section 2.12', () => {
    const expected = `pgmoat  Governed Postgres access for AI agents.

Usage
  pgmoat <postgres-url>            Start with safe defaults (no config file)
  pgmoat <command> [options]

Commands
  init            Create pgmoat.yaml for a database
  start           Start the MCP server
  validate        Check pgmoat.yaml against the schema and the database
  doctor          Check the database role for unsafe privileges
  audit           tail | query | verify | prune audit logs
  schema-export   Write the visible schema as Markdown
  test-corpus     Run the adversarial safety corpus against a scratch database
  version         Show versions

Options
  --config <path>     Config file (default: ./pgmoat.yaml)
  --url-env <VAR>     Read the connection URL from an environment variable
  --json              Machine-readable output
  --no-color          Disable colors (NO_COLOR is also honored)
  -h, --help          Show help

Docs     https://pgmoat.dev/docs
Issues   https://github.com/kitalonlabs/pgmoat/issues`;

    expect(HELP_TEXT).toBe(expected);
  });

  it('detects zero-config URL correctly', () => {
    expect(detectZeroConfig(['postgresql://localhost:5432/mydb'])).toBe(
      'postgresql://localhost:5432/mydb',
    );
    expect(detectZeroConfig(['postgres://app_user:secret@10.0.0.1:5432/production'])).toBe(
      'postgres://app_user:secret@10.0.0.1:5432/production',
    );
    expect(detectZeroConfig(['--json', 'postgres://localhost/test'])).toBe(
      'postgres://localhost/test',
    );

    // Subcommands should NOT trigger zero config
    expect(detectZeroConfig(['start', '--config', 'pgmoat.yaml'])).toBeNull();
    expect(detectZeroConfig(['test-corpus', '--url', 'postgresql://localhost:5432/test'])).toBeNull();
    expect(detectZeroConfig(['version'])).toBeNull();
    expect(detectZeroConfig(['init'])).toBeNull();
    expect(detectZeroConfig(['--help'])).toBeNull();
  });

  it('maps exit codes according to spec/06 section 2.13', () => {
    // 0 = Success
    expect(getExitCode()).toBe(EXIT_SUCCESS);
    expect(getExitCode(null)).toBe(EXIT_SUCCESS);

    // 2 = Connection or system error
    const connErr = refuse('PGM-101', 'Cannot connect to Postgres');
    expect(getExitCode(connErr)).toBe(EXIT_CONNECTION_ERROR);
    const poolErr = fail('PGM-504', 'Pool exhausted');
    expect(getExitCode(poolErr)).toBe(EXIT_CONNECTION_ERROR);
    const econnrefused = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    expect(getExitCode(econnrefused)).toBe(EXIT_CONNECTION_ERROR);

    // 3 = Config error (1xx except 101)
    const cfgErr102 = refuse('PGM-102', 'Scoped-write misconfigured');
    expect(getExitCode(cfgErr102)).toBe(EXIT_CONFIG_ERROR);
    const cfgErr105 = refuse('PGM-105', 'rls.required with no session variables');
    expect(getExitCode(cfgErr105)).toBe(EXIT_CONFIG_ERROR);
    const cfgErr112 = refuse('PGM-112', 'Unknown table in config');
    expect(getExitCode(cfgErr112)).toBe(EXIT_CONFIG_ERROR);

    // 1 = Check failed or user error (2xx, 3xx, 4xx, etc.)
    const writeErr = refuse('PGM-201', 'Write statements are not allowed in read-only mode');
    expect(getExitCode(writeErr)).toBe(EXIT_USER_ERROR);
    const budgetErr = refuse('PGM-301', 'Result row count exceeded');
    expect(getExitCode(budgetErr)).toBe(EXIT_USER_ERROR);
    const genericErr = new Error('Invalid option passed');
    expect(getExitCode(genericErr)).toBe(EXIT_USER_ERROR);
  });

  it('returns valid version JSON shape', async () => {
    const info = await getVersionInfo();
    expect(info).toHaveProperty('pgmoat');
    expect(info).toHaveProperty('node');
    expect(info).toHaveProperty('parser');
    expect(info).toHaveProperty('protocols');

    expect(typeof info.pgmoat).toBe('string');
    expect(typeof info.node).toBe('string');
    expect(typeof info.parser).toBe('number');
    expect(info.parser).toBeGreaterThan(0);
    expect(Array.isArray(info.protocols)).toBe(true);
    expect(info.protocols).toContain('2026-07-28');
    expect(info.protocols).toContain('2025-11-25');
  });

  it('formats error template per spec/06 section 2.3', () => {
    const err = new PgmoatError(
      'PGM-201',
      'Write statements are not allowed in read-only mode',
      'refused',
      'pgmoat only runs SELECT, SHOW, and plan-only EXPLAIN in read-only mode.\nScoped writes arrive in v1.1.',
    );

    const formatted = formatError(
      err,
      {
        statement: 'DeleteStmt',
        sql: "DELETE FROM users WHERE id = 'abc'",
        mode: 'read-only',
      },
      { noColor: true, json: false },
    );

    expect(formatted).toContain('x PGM-201  Write statements are not allowed in read-only mode');
    expect(formatted).toContain('  Statement:  DeleteStmt');
    expect(formatted).toContain("  SQL:        DELETE FROM users WHERE id = 'abc'");
    expect(formatted).toContain('  Mode:       read-only');
    expect(formatted).toContain('  Fix: pgmoat only runs SELECT, SHOW, and plan-only EXPLAIN in read-only mode.');
    expect(formatted).toContain('       Scoped writes arrive in v1.1.');
    expect(formatted).toContain('  https://pgmoat.dev/docs/errors/PGM-201');

    // Test JSON format
    const jsonFormatted = formatError(
      err,
      {
        statement: 'DeleteStmt',
        sql: "DELETE FROM users WHERE id = 'abc'",
        mode: 'read-only',
      },
      { json: true },
    );

    const parsed = JSON.parse(jsonFormatted);
    expect(parsed).toEqual({
      level: 'error',
      code: 'PGM-201',
      title: 'Write statements are not allowed in read-only mode',
      details: {
        statement: 'DeleteStmt',
        sql: "DELETE FROM users WHERE id = 'abc'",
        mode: 'read-only',
      },
      fix: 'pgmoat only runs SELECT, SHOW, and plan-only EXPLAIN in read-only mode.\nScoped writes arrive in v1.1.',
      docs: 'https://pgmoat.dev/docs/errors/PGM-201',
    });
  });

  it('runs help without errors via runCli', async () => {
    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write;

    try {
      await runCli(['--help']);
      const output = stdoutChunks.join('');
      expect(output).toContain(HELP_TEXT);
    } finally {
      process.stdout.write = origWrite;
    }
  });

  it('runs version command in human and json modes', async () => {
    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write;

    try {
      // Human mode
      await runCli(['version']);
      const humanOutput = stdoutChunks.join('');
      expect(humanOutput).toContain('pgmoat');
      expect(humanOutput).toContain('node');
      expect(humanOutput).toContain('parser grammar');
      expect(humanOutput).toContain('protocols 2026-07-28, 2025-11-25');

      // JSON mode
      stdoutChunks.length = 0;
      await runCli(['--json', 'version']);
      const jsonOutput = stdoutChunks.join('');
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.parser).toBeGreaterThan(0);
      expect(parsed.protocols).toEqual(['2026-07-28', '2025-11-25']);
    } finally {
      process.stdout.write = origWrite;
    }
  });
});
