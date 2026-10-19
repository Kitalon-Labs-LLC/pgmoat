#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CLI_PATH = join(__dirname, '../../packages/cli/dist/bin.mjs');

console.log('Testing Internal Analytics Example:');
console.log('1. Starting pgmoat with analytical budgets, catalog access enabled, and audit log');

const child = spawn(process.execPath, [CLI_PATH, 'start', '--config', join(__dirname, 'pgmoat.yaml')], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: {
    ...process.env,
    DATABASE_URL: 'postgresql://analytics_ro:secretpassword@127.0.0.1:54322/warehouse_db',
  },
});

let buffer = '';
child.stdout.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      handleMessage(msg);
    } catch {
      // ignore
    }
  }
});

function send(req) {
  child.stdin.write(JSON.stringify(req) + '\n');
}

function handleMessage(msg) {
  if (msg.id === 1) {
    console.log('✓ Initialized MCP server');
    // Analytical query with grouping
    send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'query',
        arguments: {
          sql: 'SELECT event_type, count(*) AS total_count FROM events GROUP BY event_type ORDER BY total_count DESC',
        },
      },
    });
  } else if (msg.id === 2) {
    console.log('✓ Group-by analytical query returned:');
    console.log(' ', msg.result?.content?.[0]?.text?.slice(0, 150));
    // Query catalog table (permitted by catalogs.allow: true)
    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'query',
        arguments: {
          sql: "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'",
        },
      },
    });
  } else if (msg.id === 3) {
    console.log('✓ Catalog query succeeded:');
    console.log(' ', msg.result?.content?.[0]?.text?.slice(0, 150));
    child.kill();
    process.exit(0);
  }
}

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'analytics-client', version: '1.0.0' },
  },
});
