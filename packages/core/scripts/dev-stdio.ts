#!/usr/bin/env node
/* eslint-disable security/detect-object-injection */
import { buildZeroConfig } from '../src/config/defaults.js';
import { createRuntime } from '../src/runtime.js';
import { startStdio } from '../src/server/stdio.js';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stderr.write(`
Usage: tsx scripts/dev-stdio.ts [options] [connection-url]

Starts a pgmoat MCP stdio server with zero-config against the given Postgres URL.
Suitable for testing with the MCP Inspector:
  npx @modelcontextprotocol/inspector tsx packages/core/scripts/dev-stdio.ts "postgresql://user:pw@localhost:5432/db"

Options:
  --help, -h             Show this help message
  --allow-unsafe-role    Bypass doctor preflight failures for unsafe roles
  --url-env <VAR>        Read connection URL from specified environment variable
\n`);
  process.exit(0);
}

async function main(): Promise<void> {
  let url = process.env.PGMOAT_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';
  let allowUnsafeRole = false;
  let fromArgvPassword = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--allow-unsafe-role') {
      allowUnsafeRole = true;
    } else if (arg === '--url-env' && args[i + 1]) {
      const varName = args[++i]!;
      url = process.env[varName] || url;
    } else if (arg && !arg.startsWith('-')) {
      url = arg;
      if (url.includes(':') && url.includes('@')) {
        fromArgvPassword = true;
      }
    }
  }

  const config = buildZeroConfig(url);
  const runtime = await createRuntime(config, {
    allowUnsafeRole,
    transport: 'stdio',
    stdoutGuard: true,
  });

  startStdio(runtime, {
    isZeroConfig: true,
    fromArgvPassword,
  });
}

main().catch((err: unknown) => {
  const errObj = err instanceof Error ? err : new Error(String(err));
  process.stderr.write(`[Fatal error] ${errObj.stack ?? errObj.message}\n`);
  process.exit(1);
});
