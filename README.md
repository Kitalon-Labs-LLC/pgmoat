# pgmoat

> Governed Postgres access for AI agents.
> Governed PostgreSQL Model Context Protocol (MCP) server for AI agents.

An open-source Model Context Protocol (MCP) server that provides AI agents with secure, read-only access to PostgreSQL databases through multi-layered SQL safety, least-privilege visibility, identity-bound Row-Level Security (RLS), context budgets, and tamper-evident audit logging.
[![CI](https://github.com/kitalonlabs/pgmoat/actions/workflows/ci.yml/badge.svg)](https://github.com/kitalonlabs/pgmoat/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/pgmoat.svg)](https://www.npmjs.com/package/pgmoat)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Installation
`pgmoat` provides autonomous AI agents with secure, read-only PostgreSQL access. It combines AST-level SQL validation, schema masking, identity-bound Row-Level Security (RLS), context budgets, and tamper-evident audit logging.

---

## Key Capabilities

- **Zero-Config Drop-in Compatibility**: Replace archived `@modelcontextprotocol/server-postgres` commands with `pgmoat` directly.
- **Fail-Closed Safety Pipeline**: Validates queries using the native PostgreSQL parser (`libpg-query`). Strictly forbids writes, multi-statements, administrative operations, and unauthorized catalog inspection.
- **Defense in Depth**: Every query executes within single-transaction read-only sessions (`SET TRANSACTION READ ONLY`) with strict statement timeouts.
- **Column and Relation Masking**: Hide sensitive credentials, tokens, or tables; queries referencing masked elements fail closed with identical errors as non-existent relations.
- **Identity-Bound RLS**: Maps verified OAuth 2.0 JWT claims to PostgreSQL session parameters (`SET LOCAL`) on every connection.
- **Cryptographic Audit Log**: Emits structured NDJSON audit logs with SHA-256 hash chaining to detect tampering or record omission.

---

## Quickstart

Run directly using `npx`:

```bash
npx -y pgmoat postgresql://user:password@localhost:5432/mydb
npx -y pgmoat postgresql://readonly_user:password@localhost:5432/mydb
```

Or add to Claude Code:
Or configure in Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "pgmoat", "postgresql://readonly_user:password@localhost:5432/mydb"]
    }
  }
}
```

Or connect in Claude Code:

```bash
claude mcp add pgmoat -- npx -y pgmoat postgresql://user:password@localhost:5432/mydb
claude mcp add pgmoat -- npx -y pgmoat postgresql://readonly_user:password@localhost:5432/mydb
```

---

## Docker Deployment

`pgmoat` publishes official multi-architecture images (`linux/amd64`, `linux/arm64`) running as non-root user `node` (UID 1000):

```bash
docker run -i --rm \
  -e PGMOAT_DATABASE_URL="postgresql://readonly_user:password@host.docker.internal:5432/mydb" \
  ghcr.io/kitalonlabs/pgmoat:latest
```

---

## Configuration Example

For advanced deployments, define a `pgmoat.yaml` configuration file:

```yaml
database:
  url_env: DATABASE_URL

schemas:
  expose:
    - public

hide:
  columns:
    public.users:
      - password_hash
      - mfa_secret

budgets:
  max_rows: 200
  max_sql_chars: 16384
  statement_timeout_ms: 3000

catalogs:
  allow: false

audit:
  destinations:
    - type: file
      path: ./audit.log
```

Start with explicit configuration:

```bash
pgmoat start --config ./pgmoat.yaml
```

---

## What pgmoat will not do

- **It does not stop prompt injection.** It removes the write path, hides what you mark hidden, and labels returned data as untrusted, but an agent with other tools (web access, email) can still be tricked into sending readable data elsewhere.
- **It does not replace Postgres permissions.** The strongest control is a dedicated Postgres role with only the grants it needs. pgmoat checks for this and warns if over-privileged, but the operator owns database role configuration.
- **It does not make RLS policies correct.** It sets the session variables your policies read from trusted identity claims. If a policy is logically flawed, pgmoat cannot fix it.
- **It does not see triggers, views with side effects, or functions it does not know.** It denies unknown functions by default.
- **It does not guarantee audit delivery to a remote destination during an outage.** It buffers, alarms, and records drops.
- **Prompt Injection Neutralization**: `pgmoat` eliminates database write paths and hides restricted tables, but an agent with separate network tools (e.g. web browsing, email dispatch) may still leak readable data if prompted adversarially.
- **Database Role Ownership**: `pgmoat` enforces least privilege at the application boundary, but operators must still configure restricted PostgreSQL credentials with read-only database grants.
- **Logical RLS Soundness**: `pgmoat` reliably maps identity claims to session settings; operators remain responsible for authoring correct PostgreSQL RLS policy expressions.

## Quickstart
---

*Coming soon.* See [spec/08-pgmoat-implementation-plan.md](spec/08-pgmoat-implementation-plan.md) for roadmap and milestones.
## Documentation

## Safety Model
Full guides and references are available in the [documentation site](packages/docs/):
- [Getting Started Guide](packages/docs/src/content/docs/getting-started/quickstart.mdx)
- [Safety Guarantees & Pipeline Architecture](packages/docs/src/content/docs/safety/guarantees.mdx)
- [CLI Reference](packages/docs/src/content/docs/reference/cli.md)
- [Configuration Schema](packages/docs/src/content/docs/reference/config.md)
- [Error Codes Directory (PGM-xxx)](packages/docs/src/content/docs/reference/errors/)

See [spec/03-pgmoat-technical-architecture.md](spec/03-pgmoat-technical-architecture.md) for the multi-layer defense-in-depth safety pipeline, AST-level validation, and execution invariants.
---

## Security

Please report vulnerabilities confidentially to `security@kitalonlabs.com`. Review [SECURITY.md](SECURITY.md) for vulnerability disclosure timelines and policy.

---

## License

MIT © 2026 Kitalon Labs
MIT (c) 2026 Kitalon Labs
