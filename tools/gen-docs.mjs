#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const docsDir = path.join(rootDir, 'packages', 'docs');
const errorsOutDir = path.join(docsDir, 'src', 'content', 'docs', 'reference', 'errors');
const specPath = path.join(rootDir, 'spec', '05-pgmoat-backend-schema.md');

const isCheck = process.argv.includes('--check');

// 1. Ensure directories exist
fs.mkdirSync(errorsOutDir, { recursive: true });
fs.mkdirSync(path.join(docsDir, 'public', 'schema'), { recursive: true });
fs.mkdirSync(path.join(docsDir, 'src', 'content', 'docs', 'reference'), { recursive: true });

// 2. Parse Error Code Registry from Spec 05
const content = fs.readFileSync(specPath, 'utf8');
const section4 = content.split('## 4) Error code registry')[1].split('## 5)')[0];
const subSections = section4.split('### ');
const errors = [];

for (const sub of subSections) {
  if (!sub.trim()) continue;
  const lines = sub.split('\n');
  const tableLines = lines.filter((l) => l.trim().startsWith('|'));
  if (tableLines.length < 3) continue;
  const headers = tableLines[0].split('|').map((s) => s.trim()).filter(Boolean);

  for (let i = 2; i < tableLines.length; i++) {
    const cells = tableLines[i].split('|').map((s) => s.trim()).slice(1, -1);
    if (!cells[0] || !cells[0].startsWith('PGM-')) continue;
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] || '';
    });
    errors.push({
      code: row.Code,
      cause: row.Cause || row.Finding || 'Error encountered',
      fix: row.Fix || row.Remediation || 'Check configuration and permissions',
      kind: row.Kind || 'error',
      http: row.HTTP || '',
    });
  }
}

console.log(`Parsed ${errors.length} error codes from specification.`);

let hasDiff = false;

// 3. Generate Error Documentation Pages
for (const err of errors) {
  const filePath = path.join(errorsOutDir, `${err.code}.md`);
  const doc = `---
title: "${err.code}: ${err.cause.replace(/"/g, '\\"')}"
description: "Reference guide and resolution steps for error ${err.code}"
---

# ${err.code}: ${err.cause}

## When you see it
${err.cause}

## What pgmoat did
pgmoat intercepted the operation safely before executing any unsafe commands on Postgres. The attempt was logged in the audit trail.

## Kind
\`${err.kind}\`${err.http ? ` (HTTP status: ${err.http})` : ''}

## Fix
${err.fix}

## Verification
Run \`pgmoat validate\` or \`pgmoat doctor\` to confirm your role and configuration satisfy safety guarantees.
`;

  if (isCheck) {
    if (!fs.existsSync(filePath) || fs.readFileSync(filePath, 'utf8') !== doc) {
      console.error(`Doc out of sync: ${filePath}`);
      hasDiff = true;
    }
  } else {
    fs.writeFileSync(filePath, doc);
  }
}

// 4. Generate CLI Reference Page
const cliDocPath = path.join(docsDir, 'src', 'content', 'docs', 'reference', 'cli.md');
const cliDoc = `---
title: "CLI Command Reference"
description: "Reference guide for all pgmoat commands and flags"
---

# CLI Command Reference

\`pgmoat\` is governed Postgres access for AI agents.

## Synopsis

\`\`\`bash
pgmoat <postgres-url>            # Start with safe defaults (zero-config)
pgmoat <command> [options]       # Execute a subcommand
\`\`\`

## Global Options

| Option | Description |
|---|---|
| \`--config <path>\` | Path to pgmoat.yaml (default: \`./pgmoat.yaml\`) |
| \`--url-env <VAR>\` | Read connection URL from environment variable |
| \`--json\` | Output machine-readable JSON |
| \`--no-color\` | Disable terminal ANSI color output |
| \`-v, --version\` | Display version information |
| \`-h, --help\` | Display command help |

## Subcommands

### \`pgmoat start [url]\`
Start the MCP server using either stdio or HTTP transport according to \`pgmoat.yaml\`.
- \`--config <path>\`: Configuration file path
- \`--url-env <VAR>\`: Environment variable containing connection string
- \`--allow-unsafe-role\`: Bypass doctor preflight safety refusal (override recorded in audit)
- \`--log-level <level>\`: debug, info, warn, error

### \`pgmoat init\`
Interactive wizard to introspect a Postgres database and generate a safe \`pgmoat.yaml\` file.
- \`-y, --yes\`: Accept recommended defaults without interactive prompts
- \`--merge\`: Merge into existing configuration without overwriting custom annotations

### \`pgmoat validate\`
Validate \`pgmoat.yaml\` against the configuration schema and the live database schema.
- \`--strict\`: Fail with non-zero exit code on warnings

### \`pgmoat doctor\`
Audit the database role for dangerous privileges (SUPERUSER, CREATEDB, BYPASSRLS, write grants).
- \`--strict\`: Treat warnings as failures

### \`pgmoat audit\`
Inspect, query, and verify tamper-evident audit logs.
- \`pgmoat audit tail\`: Stream newest audit entries in real-time
- \`pgmoat audit query\`: Filter audit records by date, tool, status, tenant, principal
- \`pgmoat audit verify\`: Mathematically verify the SHA-256 tamper-evident hash chain
- \`pgmoat audit prune\`: Safely remove old audit logs beyond retention window

### \`pgmoat schema-export\`
Export visible schema documentation as Markdown for LLM prompt context.
- \`-o, --output <path>\`: File destination (defaults to stdout)
- \`--include-hidden-count\`: Include counts of hidden tables and sensitive columns
`;

if (isCheck) {
  if (!fs.existsSync(cliDocPath) || fs.readFileSync(cliDocPath, 'utf8') !== cliDoc) {
    console.error(`Doc out of sync: ${cliDocPath}`);
    hasDiff = true;
  }
} else {
  fs.writeFileSync(cliDocPath, cliDoc);
}

// 5. Generate Config Reference Page
const configDocPath = path.join(docsDir, 'src', 'content', 'docs', 'reference', 'config.md');
const configDoc = `---
title: "pgmoat.yaml Reference"
description: "Complete reference for pgmoat configuration schema"
---

# pgmoat.yaml Reference

\`pgmoat.yaml\` configures connection, budgets, column visibility, row-level security, and audit destinations.

## Schema Layout

\`\`\`yaml
version: 1

server:
  name: "support-agent-db"
  description: "Read-only access for internal customer support bot"

transport: stdio # "stdio" or "http"

http:
  host: "0.0.0.0"
  port: 8787
  path: "/mcp"
  allowed_hosts: ["pgmoat.internal"]
  allowed_origins: []
  max_body_bytes: 1048576

auth:
  mode: "oauth" # "none" or "oauth"
  issuer: "https://auth.acme.com/"
  audience: "https://pgmoat.acme.com/mcp"
  jwks_url: "https://auth.acme.com/.well-known/jwks.json"
  algorithms: ["RS256"]
  required_scopes: ["pgmoat:read"]

connection:
  url: \${PGMOAT_DATABASE_URL}
  schemas:
    - public

mode: read-only

budgets:
  max_rows: 200
  max_query_ms: 5000
  max_payload_bytes: 65536
  max_columns: 50

rls:
  required: false
  session_variables:
    app.tenant_id: "token.tenant_id"

policy:
  allow_catalog_queries: false
  strict_unqualified_columns: true

tables:
  users:
    description: "Application users"
    columns:
      id: { description: "User primary key" }
      email: { description: "User email", sensitive: medium }
      password_hash: { hidden: true }

audit:
  destination: file # "stderr", "file", or "postgres"
  path: "./pgmoat-audit"
\`\`\`
`;

if (isCheck) {
  if (!fs.existsSync(configDocPath) || fs.readFileSync(configDocPath, 'utf8') !== configDoc) {
    console.error(`Doc out of sync: ${configDocPath}`);
    hasDiff = true;
  }
} else {
  fs.writeFileSync(configDocPath, configDoc);
}

// 6. Generate JSON Schema
const schemaPath = path.join(docsDir, 'public', 'schema', 'pgmoat.v1.json');
const schemaJson = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "PgmoatConfig",
  type: "object",
  required: ["version", "server", "transport", "connection", "mode", "budgets", "audit"],
  properties: {
    version: { type: "integer", const: 1 },
    server: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        description: { type: "string" }
      }
    },
    transport: { type: "string", enum: ["stdio", "http"] },
    mode: { type: "string", const: "read-only" },
    budgets: {
      type: "object",
      required: ["max_rows", "max_query_ms", "max_payload_bytes"],
      properties: {
        max_rows: { type: "integer", minimum: 1 },
        max_query_ms: { type: "integer", minimum: 1 },
        max_payload_bytes: { type: "integer", minimum: 1024 },
        max_columns: { type: "integer", minimum: 1 }
      }
    }
  }
};

if (isCheck) {
  if (!fs.existsSync(schemaPath)) {
    console.error(`Doc schema missing: ${schemaPath}`);
    hasDiff = true;
  }
} else {
  fs.writeFileSync(schemaPath, JSON.stringify(schemaJson, null, 2) + '\n');
}

if (isCheck && hasDiff) {
  console.error('Check failed: Generated docs are out of sync. Run node tools/gen-docs.mjs to update.');
  process.exit(1);
}

console.log('Documentation generation complete.');
