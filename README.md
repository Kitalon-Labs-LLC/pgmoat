# pgmoat

> Governed PostgreSQL Model Context Protocol (MCP) server for AI agents.

[![CI](https://github.com/kitalonlabs/pgmoat/actions/workflows/ci.yml/badge.svg)](https://github.com/kitalonlabs/pgmoat/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/pgmoat.svg)](https://www.npmjs.com/package/pgmoat)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

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
npx -y pgmoat postgresql://readonly_user:password@localhost:5432/mydb
```

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

## What pgmoat Does Not Do

- **Prompt Injection Neutralization**: `pgmoat` eliminates database write paths and hides restricted tables, but an agent with separate network tools (e.g. web browsing, email dispatch) may still leak readable data if prompted adversarially.
- **Database Role Ownership**: `pgmoat` enforces least privilege at the application boundary, but operators must still configure restricted PostgreSQL credentials with read-only database grants.
- **Logical RLS Soundness**: `pgmoat` reliably maps identity claims to session settings; operators remain responsible for authoring correct PostgreSQL RLS policy expressions.

---

## Documentation

Full guides and references are available in the [documentation site](packages/docs/):
- [Getting Started Guide](packages/docs/src/content/docs/getting-started/quickstart.mdx)
- [Safety Guarantees & Pipeline Architecture](packages/docs/src/content/docs/safety/guarantees.mdx)
- [CLI Reference](packages/docs/src/content/docs/reference/cli.md)
- [Configuration Schema](packages/docs/src/content/docs/reference/config.md)
- [Error Codes Directory (PGM-xxx)](packages/docs/src/content/docs/reference/errors/)

---

## Security

Please report vulnerabilities confidentially to `security@kitalonlabs.com`. Review [SECURITY.md](SECURITY.md) for vulnerability disclosure timelines and policy.

---

## License

MIT (c) 2026 Kitalon Labs
