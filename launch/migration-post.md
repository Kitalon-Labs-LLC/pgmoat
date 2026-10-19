# Migrating from @modelcontextprotocol/server-postgres to pgmoat

With Anthropic archiving the reference `@modelcontextprotocol/server-postgres` package in early 2026, many production deployments need an actively maintained, governed MCP server.

`pgmoat` is designed as a drop-in replacement that preserves familiar CLI arguments and tool signatures while introducing multi-layered safety guardrails.

---

## 1. Zero-Downtime Command Replacement

In your client configuration (`claude_desktop_config.json`, Cursor MCP settings, or systemd units), replace the package name:

### Claude Desktop Before

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://readonly@localhost:5432/mydb"]
    }
  }
}
```

### Claude Desktop After

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "pgmoat", "postgresql://readonly@localhost:5432/mydb"]
    }
  }
}
```

---

## 2. Tool Surface Compatibility

`pgmoat` maintains compatibility with the core tools agents expect:

| Tool | Archived Server | pgmoat | Key Governance Differences |
|---|---|---|---|
| `query` | Raw SQL query execution | AST-validated execution | Enforces read-only AST, limits rows, truncates oversize cells. |
| `explain` | Supported | Supported | Forbids `ANALYZE` option to prevent write-through execution. |
| `list_tables` | Direct catalog dump | Filtered relation list | Hides unexposed schemas and tables configured in `hide.tables`. |
| `describe_table` | Raw column dump | Filtered column schema | Excludes sensitive columns configured in `hide.columns`. |

---

## 3. What Changes Behind the Scenes

1. **Parser-Level Protection**: Queries are parsed by `libpg-query` before database dispatch. Statement stacking (`SELECT 1; DROP TABLE users`) and writing CTEs (`WITH d AS (DELETE FROM ...)`) are blocked with structured error codes (`PGM-201`, `PGM-204`).
2. **Transaction Mode**: Every query executes within an explicit `BEGIN READ ONLY` block with a statement timeout (`statement_timeout_ms`).
3. **No Catalog Leaks by Default**: Agents cannot browse `pg_catalog` or internal PostgreSQL system tables unless explicitly authorized in `pgmoat.yaml`.

---

## 4. Graduating to a Governed Configuration

When ready to add column masking, row limits, or audit logging, initialize a `pgmoat.yaml`:

```bash
pgmoat init --template enterprise
```

Reference the configuration file in your client launch arguments:

```bash
pgmoat start --config ./pgmoat.yaml
```
