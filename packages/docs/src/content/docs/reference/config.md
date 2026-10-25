---
title: "pgmoat.yaml Reference"
description: "Complete reference for pgmoat configuration schema"
---

# pgmoat.yaml Reference

`pgmoat.yaml` configures connection, budgets, column visibility, row-level security, and audit destinations.

## Schema Layout

```yaml
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
  url: ${PGMOAT_DATABASE_URL}
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
```
