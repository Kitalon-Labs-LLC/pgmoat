import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dir = path.join(
  rootDir,
  'packages',
  'core',
  'test',
  'fixtures',
  'configs',
);
fs.mkdirSync(dir, { recursive: true });

const fixtures = {
  'valid-minimal.yaml': `# expect: valid
version: 1
server:
  name: pgmoat
connection:
  url: postgresql://localhost/db
`,

  'valid-full-http.yaml': `# expect: valid
version: 1
server:
  name: acme-prod
  description: Acme production database proxy
transport: http
http:
  host: 127.0.0.1
  port: 8787
  path: /mcp
  public_url: https://mcp.acme.internal
  allowed_hosts: [mcp.acme.internal]
  allowed_origins: [https://claude.ai]
auth:
  mode: oauth
  issuer: https://auth.acme.internal
  audience: https://mcp.acme.internal
  jwks_url: https://auth.acme.internal/.well-known/jwks.json
connection:
  url: postgresql://pgmoat_reader:secret@db.acme.internal:5432/app
  schemas: [public, analytics]
  pool:
    min: 2
    max: 20
    acquire_timeout_ms: 5000
budgets:
  max_rows: 500
  max_query_ms: 10000
rls:
  required: true
  session_variables:
    app.tenant_id: token.tenant_id
policy:
  allow_catalog_queries: false
  allowed_functions: [public.business_days]
audit:
  destination: postgres
  postgres:
    url: postgresql://pgmoat_audit:secret@db.acme.internal:5432/app
    schema: pgmoat
    table: audit
`,

  'valid-stdio-meta-rls.yaml': `# expect: valid
version: 1
server:
  name: local-agent
transport: stdio
connection:
  url: postgresql://localhost/app
rls:
  trust_request_meta: true
  session_variables:
    app.tenant_id: meta.tenant_id
`,

  'valid-audit-stderr.yaml': `# expect: valid
version: 1
server:
  name: stderr-server
connection:
  url: postgresql://localhost/app
audit:
  destination: stderr
`,

  'valid-audit-file-daily.yaml': `# expect: valid
version: 1
server:
  name: file-daily
connection:
  url: postgresql://localhost/app
audit:
  destination: file
  rotation: daily
  retain_days: 30
`,

  'valid-audit-file-size.yaml': `# expect: valid
version: 1
server:
  name: file-size
connection:
  url: postgresql://localhost/app
audit:
  destination: file
  rotation: size:50MB
  retain_days: 60
`,

  'valid-audit-postgres.yaml': `# expect: valid
version: 1
server:
  name: audit-pg
connection:
  url: postgresql://localhost/app
audit:
  destination: postgres
  postgres:
    url: postgresql://localhost/audit_db
`,

  'valid-catalog-allowed.yaml': `# expect: valid
version: 1
server:
  name: catalog-server
connection:
  url: postgresql://localhost/app
policy:
  allow_catalog_queries: true
`,

  'valid-hidden-password.yaml': `# expect: valid
version: 1
server:
  name: hidden-pwd
connection:
  url: postgresql://localhost/app
tables:
  users:
    columns:
      password_hash:
        hidden: true
`,

  'valid-hidden-tables.yaml': `# expect: valid
version: 1
server:
  name: hidden-tbl
connection:
  url: postgresql://localhost/app
tables:
  internal_secrets:
    hidden: true
`,

  'valid-custom-budgets.yaml': `# expect: valid
version: 1
server:
  name: custom-budgets
connection:
  url: postgresql://localhost/app
budgets:
  max_rows: 1000
  max_query_ms: 15000
  max_columns: 100
  max_payload_bytes: 131072
`,

  'valid-custom-pool.yaml': `# expect: valid
version: 1
server:
  name: pool-config
connection:
  url: postgresql://localhost/app
  pool:
    min: 5
    max: 25
    acquire_timeout_ms: 10000
`,

  'valid-env-interpolation.yaml': `# expect: valid
version: 1
server:
  name: env-interp
connection:
  url: postgresql://\${PG_USER:-postgres}@localhost/app
`,

  'valid-env-default-interpolation.yaml': `# expect: valid
version: 1
server:
  name: default-interp
connection:
  url: postgresql://\${MISSING_USER:-default_user}@localhost/app
`,

  'valid-escaped-interpolation.yaml': `# expect: valid
version: 1
server:
  name: escaped-interp
  description: Template has \$\${LITERAL_VAR}
connection:
  url: postgresql://localhost/app
`,

  'valid-annotations-full.yaml': `# expect: valid
version: 1
server:
  name: annotated-server
connection:
  url: postgresql://localhost/app
tables:
  orders:
    description: Customer orders table
    relationships: ["users.id references customers.id"]
    columns:
      id:
        description: Primary key
      card_token:
        sensitive: high
      customer_note:
        untrusted: true
`,

  'valid-doctor-warn.yaml': `# expect: valid
version: 1
server:
  name: doc-warn
connection:
  url: postgresql://localhost/app
doctor:
  on_start: warn
`,

  'valid-doctor-off.yaml': `# expect: valid
version: 1
server:
  name: doc-off
connection:
  url: postgresql://localhost/app
doctor:
  on_start: off
`,

  'valid-ssl-require.yaml': `# expect: valid
version: 1
server:
  name: ssl-req
connection:
  url: postgresql://localhost/app
  ssl: require
`,

  'valid-ssl-verify-full.yaml': `# expect: valid
version: 1
server:
  name: ssl-verify
connection:
  url: postgresql://localhost/app
  ssl: verify-full
`,

  'valid-http-loopback-noauth.yaml': `# expect: valid
version: 1
server:
  name: loopback-noauth
transport: http
http:
  host: 127.0.0.1
auth:
  mode: none
connection:
  url: postgresql://localhost/app
`,

  'valid-http-ipv6-loopback.yaml': `# expect: valid
version: 1
server:
  name: ipv6-noauth
transport: http
http:
  host: "::1"
auth:
  mode: none
connection:
  url: postgresql://localhost/app
`,

  'invalid-syntax.yaml': `# expect: PGM-107
version: 1
server: [broken syntax
`,

  'invalid-missing-env.yaml': `# expect: PGM-108
version: 1
server:
  name: missing-env
connection:
  url: postgresql://\${REQUIRED_AND_TOTALLY_MISSING_VAR}@localhost/app
`,

  'invalid-relative-file.yaml': `# expect: PGM-108
version: 1
server:
  name: rel-file
connection:
  url: postgresql://localhost/\${file:relative/path/to/file}
`,

  'invalid-version.yaml': `# expect: PGM-109
version: 2
server:
  name: bad-ver
connection:
  url: postgresql://localhost/app
`,

  'invalid-server-name-caps.yaml': `# expect: PGM-109
version: 1
server:
  name: BAD_NAME
connection:
  url: postgresql://localhost/app
`,

  'invalid-server-name-dash.yaml': `# expect: PGM-109
version: 1
server:
  name: -leading-dash
connection:
  url: postgresql://localhost/app
`,

  'invalid-budget-rows-negative.yaml': `# expect: PGM-109
version: 1
server:
  name: bad-budget
budgets:
  max_rows: -5
connection:
  url: postgresql://localhost/app
`,

  'invalid-budget-payload-low.yaml': `# expect: PGM-109
version: 1
server:
  name: bad-payload
budgets:
  max_payload_bytes: 50
connection:
  url: postgresql://localhost/app
`,

  'invalid-connection-empty.yaml': `# expect: PGM-109
version: 1
server:
  name: empty-conn
connection:
  url: ""
`,

  'invalid-unknown-key.yaml': `# expect: PGM-109
version: 1
server:
  name: unknown-key
unknown_section: true
connection:
  url: postgresql://localhost/app
`,

  'invalid-rls-setting-no-dot.yaml': `# expect: PGM-109
version: 1
server:
  name: bad-rls-key
connection:
  url: postgresql://localhost/app
rls:
  session_variables:
    tenant_id: static:abc
`,

  'invalid-rls-source-bad-prefix.yaml': `# expect: PGM-109
version: 1
server:
  name: bad-rls-src
connection:
  url: postgresql://localhost/app
rls:
  session_variables:
    app.tenant: header.tenant_id
`,

  'invalid-scoped-write-v1.yaml': `# expect: PGM-102
version: 1
server:
  name: scoped-write-server
mode: scoped-write
connection:
  url: postgresql://localhost/app
`,

  'invalid-update-columns-no-update.yaml': `# expect: PGM-103
version: 1
server:
  name: update-cols-bad
connection:
  url: postgresql://localhost/app
tables:
  users:
    update_columns: [email]
    write: [insert]
`,

  'invalid-rls-required-empty.yaml': `# expect: PGM-105
version: 1
server:
  name: rls-empty
connection:
  url: postgresql://localhost/app
rls:
  required: true
  session_variables: {}
`,

  'invalid-pool-min-greater-max.yaml': `# expect: PGM-106
version: 1
server:
  name: pool-reversed
connection:
  url: postgresql://localhost/app
  pool:
    min: 15
    max: 5
`,

  'invalid-stdout-stdio.yaml': `# expect: PGM-111
version: 1
server:
  name: stdout-stdio
transport: stdio
connection:
  url: postgresql://localhost/app
audit:
  destination: stdout
`,

  'invalid-meta-http.yaml': `# expect: PGM-112
version: 1
server:
  name: meta-http
transport: http
connection:
  url: postgresql://localhost/app
rls:
  trust_request_meta: true
  session_variables:
    app.tenant: meta.tenant_id
`,

  'invalid-meta-untrusted-stdio.yaml': `# expect: PGM-112
version: 1
server:
  name: meta-untrusted
transport: stdio
connection:
  url: postgresql://localhost/app
rls:
  trust_request_meta: false
  session_variables:
    app.tenant: meta.tenant_id
`,

  'invalid-token-stdio.yaml': `# expect: PGM-113
version: 1
server:
  name: token-stdio
transport: stdio
connection:
  url: postgresql://localhost/app
rls:
  session_variables:
    app.tenant: token.sub
`,

  'invalid-public-bind-noauth.yaml': `# expect: PGM-114
version: 1
server:
  name: public-noauth
transport: http
http:
  host: 0.0.0.0
auth:
  mode: none
connection:
  url: postgresql://localhost/app
`,

  'invalid-oauth-missing-fields.yaml': `# expect: PGM-116
version: 1
server:
  name: oauth-missing
transport: http
http:
  host: 127.0.0.1
auth:
  mode: oauth
  issuer: https://auth.example.com
connection:
  url: postgresql://localhost/app
`,

  'invalid-audience-mismatch-strict.yaml': `# expect: PGM-117
version: 1
server:
  name: aud-mismatch
transport: http
http:
  host: 127.0.0.1
  public_url: https://mcp.example.com
auth:
  mode: oauth
  issuer: https://auth.example.com
  audience: https://different.example.com
  jwks_url: https://auth.example.com/jwks.json
connection:
  url: postgresql://localhost/app
`,
};

for (const [filename, content] of Object.entries(fixtures)) {
  fs.writeFileSync(path.join(dir, filename), content);
}
console.log(`Created ${Object.keys(fixtures).length} fixtures.`);
