# pgmoat

> Governed Postgres access for AI agents.

pgmoat is an open-source MCP server that gives AI agents read-only access to Postgres. It checks every query with the real Postgres parser, hides the tables and columns you mark hidden, applies row limits and timeouts, binds Row-Level Security to the caller's identity, and writes a tamper-evident audit log.

Requires Node.js 22.12 or newer and Postgres 15 to 18.

## Quickstart

Run it against your database with safe defaults, no config file needed:

```bash
npx -y pgmoat postgresql://readonly_user:password@localhost:5432/mydb
```

Add it to Claude Code:

```bash
claude mcp add pgmoat -- npx -y pgmoat postgresql://readonly_user:password@localhost:5432/mydb
```

Or to Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "pgmoat": {
      "command": "npx",
      "args": ["-y", "pgmoat", "--url-env", "PGMOAT_DATABASE_URL"],
      "env": { "PGMOAT_DATABASE_URL": "postgresql://readonly_user:password@localhost:5432/mydb" }
    }
  }
}
```

Passing the URL through `--url-env` keeps the password out of process listings.

Use a dedicated read-only role. pgmoat warns at startup if the role is a superuser or can write.

## Add descriptions and hide sensitive data

```bash
export PGMOAT_DATABASE_URL=postgresql://readonly_user:password@localhost:5432/mydb
npx pgmoat init          # writes pgmoat.yaml; auto-hides columns like password_hash and token_hash
npx pgmoat validate      # checks the file against the schema and the database
npx pgmoat doctor        # checks the role for unsafe privileges
npx pgmoat start         # starts the server with ./pgmoat.yaml
```

A `pgmoat.yaml` looks like this:

```yaml
version: 1
server:
  name: mydb
connection:
  url: ${PGMOAT_DATABASE_URL}
  schemas: [public]
mode: read-only
budgets:
  max_rows: 200
  max_query_ms: 5000
tables:
  users:
    description: "One row per login account"
    columns:
      password_hash: { hidden: true }
      email:         { sensitive: high }
```

## Commands

| Command | What it does |
|---|---|
| `pgmoat <postgres-url>` | Start with safe defaults (no config file) |
| `pgmoat init` | Create `pgmoat.yaml` from your database |
| `pgmoat start` | Start the MCP server from `pgmoat.yaml` |
| `pgmoat validate` | Check `pgmoat.yaml` against the schema and the database |
| `pgmoat doctor` | Check the database role for unsafe privileges |
| `pgmoat audit verify` | Verify the audit log hash chain |
| `pgmoat schema-export` | Write the visible schema as Markdown |

Run `pgmoat --help` for all options.

## What pgmoat does not do

- **It does not stop prompt injection.** It removes the write path, hides what you mark hidden, and labels returned data as untrusted, but an agent with other tools (web access, email) can still be tricked into sending readable data elsewhere.
- **It does not replace Postgres permissions.** The strongest control is a dedicated role with only the grants it needs.
- **It does not make RLS policies correct.** It sets the session variables your policies read. A flawed policy stays flawed.
- **It does not guarantee audit delivery to a remote destination during an outage.** It buffers, alarms, and records drops.

## Links

- Docs: https://kitalonlabs.com/pgmoat
- Source and issues: https://github.com/Kitalon-Labs-LLC/pgmoat
- Security reports: security@kitalonlabs.com

## License

MIT (c) 2026 Kitalon Labs
