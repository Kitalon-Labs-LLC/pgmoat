#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CLI_PATH = join(__dirname, '../../packages/cli/dist/bin.mjs');

console.log('Testing Vertical AI Agent Example:');
console.log('1. Starting pgmoat over stdio with hidden employee salary/ssn');

const child = spawn(process.execPath, [CLI_PATH, 'start', '--config', join(__dirname, 'pgmoat.yaml')], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: {
    ...process.env,
    DATABASE_URL: 'postgresql://agent_ro:secretpassword@127.0.0.1:54321/corp_db',
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

let msgId = 1;
function send(req) {
  child.stdin.write(JSON.stringify(req) + '\n');
}

function handleMessage(msg) {
  if (msg.id === 1) {
    console.log('✓ Initialized MCP server protocol version:', msg.result?.protocolVersion);
    // Send safe query
    send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'query',
        arguments: {
          sql: 'SELECT e.name, e.title, d.name AS department FROM employees e JOIN departments d ON e.department_id = d.id',
        },
      },
    });
  } else if (msg.id === 2) {
    console.log('✓ Safe query succeeded with visible columns:');
    const content = msg.result?.content?.[0]?.text;
    console.log(' ', content?.slice(0, 150));
    // Now attempt to query hidden column
    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'query',
        arguments: {
          sql: 'SELECT name, salary FROM employees',
        },
      },
    });
  } else if (msg.id === 3) {
    console.log('✓ Hidden column query correctly refused:');
    console.log(' ', msg.result?.content?.[0]?.text ?? msg.error?.message);
    child.kill();
    process.exit(0);
  }
}

// Handshake
send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'vertical-ai-agent-client', version: '1.0.0' },
  },
});
