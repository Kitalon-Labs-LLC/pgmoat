#!/usr/bin/env node
import { Command } from 'commander';
import { configureOutput } from './output.js';
import { exitWithError } from './exit.js';
import { versionCommand } from './commands/version.js';

export const SUBCOMMANDS = new Set([
  'init',
  'start',
  'validate',
  'doctor',
  'audit',
  'schema-export',
  'test-corpus',
  'version',
]);

export function detectZeroConfig(args: string[]): string | null {
  for (const arg of args) {
    if (arg.startsWith('-')) continue;
    if (SUBCOMMANDS.has(arg)) return null;
    if (/^postgres(ql)?:\/\//.test(arg)) {
      return arg;
    }
  }
  return null;
}

export const HELP_TEXT = `pgmoat  Governed Postgres access for AI agents.

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

Docs     https://kitalonlabs.com/pgmoat/docs
Issues   https://github.com/Kitalon-Labs-LLC/pgmoat/issues`;

export function createProgram(): Command {
  const program = new Command();
  program
    .name('pgmoat')
    .description('Governed Postgres access for AI agents.');

  program.helpInformation = () => HELP_TEXT + '\n';

  program
    .option('--config <path>', 'Config file (default: ./pgmoat.yaml)')
    .option('--url-env <VAR>', 'Read the connection URL from an environment variable')
    .option('--json', 'Machine-readable output')
    .option('--no-color', 'Disable colors (NO_COLOR is also honored)')
    .option('-v, --version', 'Show version')
    .helpOption('-h, --help', 'Show help');

  program
    .command('version')
    .description('Show versions')
    .action(async () => {
      await versionCommand();
    });

  program
    .command('init [url]')
    .description('Create pgmoat.yaml for a database')
    .option('-y, --yes', 'Accept defaults without interactive prompts')
    .option('--merge', 'Merge into existing config without prompting')
    .option('--out <dir>', 'Directory to write pgmoat.yaml into')
    .option('--include-system', 'Include system schemas')
    .action(async (url: string | undefined, _opts, cmd: Command) => {
      const { initCommand } = await import('./commands/init.js');
      await initCommand({ ...cmd.optsWithGlobals(), ...(url ? { url } : {}) });
    });

  program
    .command('start [url]')
    .description('Start the MCP server')
    .option('--config <path>', 'Config file')
    .option('--url-env <VAR>', 'Environment variable containing connection URL')
    .option('--allow-unsafe-role', 'Allow unsafe role on doctor findings')
    .option('--log-level <level>', 'Logging level (debug, info, warn, error)')
    .action(async (url, opts, cmd) => {
      const mergedOpts = cmd.optsWithGlobals ? cmd.optsWithGlobals() : { ...program.opts(), ...opts };
      const { startCommand } = await import('./commands/start.js');
      await startCommand(url, mergedOpts);
    });

  program
    .command('validate')
    .description('Check pgmoat.yaml against the schema and the database')
    .option('--strict', 'Fail on warnings')
    .action(async (opts, cmd: Command) => {
      const { validateCommand } = await import('./commands/validate.js');
      await validateCommand({ ...cmd.optsWithGlobals(), ...opts });
    });

  program
    .command('doctor')
    .description('Check the database role for unsafe privileges')
    .option('--strict', 'Fail on warnings')
    .action(async (opts, cmd: Command) => {
      const { doctorCommand } = await import('./commands/doctor.js');
      await doctorCommand({ ...cmd.optsWithGlobals(), ...opts });
    });

  const audit = program
    .command('audit')
    .description('tail | query | verify | prune audit logs');

  audit
    .command('tail')
    .description('Tail audit logs')
    .option('--since <since>', 'Since time')
    .option('--until <until>', 'Until time')
    .option('--tool <tool>', 'Filter by tool')
    .option('--status <status>', 'Filter by status')
    .option('--tenant <tenant>', 'Filter by tenant')
    .option('--principal <principal>', 'Filter by principal')
    .option('--format <format>', 'Output format: table, csv, ndjson', 'table')
    .option('--path <path>', 'Audit directory path')
    .option('--postgres', 'Query Postgres audit table')
    .option('--url <url>', 'Postgres connection URL')
    .option('--follow', 'Follow newest entries')
    .action(async (opts) => {
      const { auditCommand } = await import('./commands/audit.js');
      await auditCommand('tail', opts);
    });

  audit
    .command('query')
    .description('Query audit logs')
    .option('--since <since>', 'Since time')
    .option('--until <until>', 'Until time')
    .option('--tool <tool>', 'Filter by tool')
    .option('--status <status>', 'Filter by status')
    .option('--tenant <tenant>', 'Filter by tenant')
    .option('--principal <principal>', 'Filter by principal')
    .option('--format <format>', 'Output format: table, csv, ndjson', 'table')
    .option('--path <path>', 'Audit directory path')
    .option('--postgres', 'Query Postgres audit table')
    .option('--url <url>', 'Postgres connection URL')
    .action(async (opts) => {
      const { auditCommand } = await import('./commands/audit.js');
      await auditCommand('query', opts);
    });

  audit
    .command('verify')
    .description('Verify tamper-evident hash chain')
    .option('--path <path>', 'Audit directory path')
    .option('--postgres', 'Verify Postgres audit table')
    .option('--url <url>', 'Postgres connection URL')
    .action(async (opts) => {
      const { auditCommand } = await import('./commands/audit.js');
      await auditCommand('verify', opts);
    });

  audit
    .command('prune')
    .description('Prune old audit files')
    .option('--path <path>', 'Audit directory path')
    .option('--older-than <duration>', 'Prune files older than duration', '30d')
    .option('--dry-run', 'List files without deleting')
    .action(async (opts) => {
      const { auditCommand } = await import('./commands/audit.js');
      await auditCommand('prune', opts);
    });

  program
    .command('schema-export')
    .description('Write the visible schema as Markdown')
    .option('--config <path>', 'Config file (default: ./pgmoat.yaml)')
    .option('-o, --output <path>', 'Output file (defaults to stdout)')
    .option('--include-hidden-count', 'Include count of hidden tables and columns')
    .action(async (opts, cmd: Command) => {
      const { schemaExportCommand } = await import('./commands/schema-export.js');
      await schemaExportCommand({ ...cmd.optsWithGlobals(), ...opts });
    });

  program
    .command('test-corpus')
    .description('Run the adversarial safety corpus against a scratch database')
    .option('--url <url>', 'Scratch Postgres database URL')
    .option('--group <group>', 'Run only specific case group')
    .option('--force', 'Force run even if database has more than 10 tables')
    .action(async (opts) => {
      const { testCorpusCommand } = await import('./commands/test-corpus.js');
      await testCorpusCommand(opts);
    });

  return program;
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const json = argv.includes('--json');
  const noColor = argv.includes('--no-color');
  configureOutput({ json, noColor });

  if (argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(HELP_TEXT + '\n');
    return;
  }

  if (argv.includes('-v') || argv.includes('--version')) {
    const { versionCommand } = await import('./commands/version.js');
    await versionCommand();
    return;
  }

  // Check for zero-config URL pattern
  const zeroConfigUrl = detectZeroConfig(argv);
  if (zeroConfigUrl) {
    const { startCommand } = await import('./commands/start.js');
    await startCommand(zeroConfigUrl, { isZeroConfig: true });
    return;
  }

  // `pgmoat --url-env VAR` with no command means `pgmoat start --url-env VAR`,
  // as the zero-config banner suggests.
  const hasCommand = argv.some((arg) => SUBCOMMANDS.has(arg));
  if (!hasCommand && argv.includes('--url-env')) {
    argv = ['start', ...argv];
  }

  const program = createProgram();
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (err: unknown) {
    exitWithError(err);
  }
}

// Auto-run if executed directly
const argv1 = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
const isDirectRun =
  Boolean(argv1 && (
    import.meta.url === `file://${argv1}` ||
    import.meta.url === `file:///${argv1}` ||
    /\/bin\.(ts|js|mjs)$/.test(argv1) ||
    /\/pgmoat(\.cmd|\.exe|\.ps1)?$/.test(argv1)
  ));

if (isDirectRun) {
  runCli().catch((err: unknown) => {
    exitWithError(err);
  });
}
