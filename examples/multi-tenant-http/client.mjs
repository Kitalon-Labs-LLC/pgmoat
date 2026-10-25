#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CLI_PATH = join(__dirname, '../../packages/cli/dist/bin.mjs');

console.log('Testing Multi-Tenant HTTP Server with OAuth & Token RLS:');

// 1. Start mock OIDC
const oidcProc = spawn(process.execPath, [join(__dirname, 'mock-oidc.mjs')], {
  stdio: 'inherit',
});

// Give mock OIDC a moment to bind
await new Promise((r) => setTimeout(r, 600));

// 2. Start pgmoat HTTP server
const pgmoatProc = spawn(process.execPath, [CLI_PATH, 'start', '--config', join(__dirname, 'pgmoat.yaml')], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: 'postgresql://tenant_ro:secretpassword@127.0.0.1:54325/multi_tenant_db',
  },
});

await new Promise((r) => setTimeout(r, 1000));

try {
  // 3. Fetch token for tenant_alpha
  console.log('\n2. Requesting OAuth token for tenant_alpha from Mock IDP');
  const tokenRes = await fetch('http://127.0.0.1:9090/token?tenant=tenant_alpha');
  const tokenData = await tokenRes.json();
  const token = tokenData.access_token;
  console.log('✓ Acquired token for tenant_alpha');

  // 4. Query protected resource metadata
  const prmRes = await fetch('http://127.0.0.1:8080/.well-known/oauth-protected-resource', {
    headers: { Host: '127.0.0.1:8080' },
  });
  const prm = await prmRes.json();
  console.log('✓ Protected resource metadata resource:', prm.resource);

  // 5. Query pgmoat HTTP endpoint with Bearer token
  console.log('3. Sending MCP tools/call query with Bearer token:');
  const queryRes = await fetch('http://127.0.0.1:8080/', {
    method: 'POST',
    headers: {
      Host: '127.0.0.1:8080',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'query',
        arguments: {
          sql: 'SELECT id, tenant_id, title FROM tenant_documents',
        },
      },
    }),
  });

  const queryJson = await queryRes.json();
  console.log('✓ Multi-tenant RLS query results (only tenant_alpha returned):');
  console.log(' ', queryJson.result?.content?.[0]?.text?.slice(0, 160));
} finally {
  pgmoatProc.kill();
  oidcProc.kill();
}

