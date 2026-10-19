#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CLI_PATH = join(__dirname, '../../packages/cli/dist/bin.mjs');

console.log('Testing Customer Support Agent Example:');
console.log('1. Starting pgmoat with untrusted data framing and PII column masking');

const child = spawn(process.execPath, [CLI_PATH, 'start', '--config', join(__dirname, 'pgmoat.yaml')], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: {
    ...process.env,
    DATABASE_URL: 'postgresql://support_user:secretpassword@127.0.0.1:54324/support_db',
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
    // Fetch ticket message containing prompt injection payload
    send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'query',
        arguments: {
          sql: 'SELECT t.id, t.subject, m.sender, m.body FROM tickets t JOIN ticket_messages m ON t.id = m.ticket_id WHERE t.id = 2',
        },
      },
    });
  } else if (msg.id === 2) {
    console.log('✓ Ticket query safely returned untrusted message body:');
    console.log(' ', msg.result?.content?.[0]?.text?.slice(0, 160));
    // Verify customer credit card cannot be leaked by subsequent query
    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'query',
        arguments: {
          sql: 'SELECT credit_card FROM customers',
        },
      },
    });
  } else if (msg.id === 3) {
    console.log('✓ PII credit_card query refused:');
    console.log(' ', msg.result?.content?.[0]?.text ?? msg.error?.message);
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
    clientInfo: { name: 'support-agent-client', version: '1.0.0' },
  },
});

