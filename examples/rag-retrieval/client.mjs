#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CLI_PATH = join(__dirname, '../../packages/cli/dist/bin.mjs');

console.log('Testing RAG Retrieval Example:');
console.log('1. Starting pgmoat with pgvector support');

const child = spawn(process.execPath, [CLI_PATH, 'start', '--config', join(__dirname, 'pgmoat.yaml')], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: {
    ...process.env,
    DATABASE_URL: 'postgresql://rag_user:secretpassword@127.0.0.1:54323/rag_db',
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
    // Vector similarity query using cosine distance (<=>)
    send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'query',
        arguments: {
          sql: "SELECT id, title, content, embedding <=> '[0.85, 0.15, 0.05]' AS distance FROM documents ORDER BY distance ASC LIMIT 2",
        },
      },
    });
  } else if (msg.id === 2) {
    console.log('✓ Vector similarity search returned nearest neighbors:');
    console.log(' ', msg.result?.content?.[0]?.text?.slice(0, 180));
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
    clientInfo: { name: 'rag-client', version: '1.0.0' },
  },
});

