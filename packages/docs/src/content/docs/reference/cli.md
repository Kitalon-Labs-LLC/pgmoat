---
title: "CLI Command Reference"
description: "Reference guide for all pgmoat commands and flags"
---

# CLI Command Reference

`pgmoat` is governed Postgres access for AI agents.

## Synopsis

```bash
pgmoat <postgres-url>            # Start with safe defaults (zero-config)
pgmoat <command> [options]       # Execute a subcommand
```

## Global Options

| Option | Description |
|---|---|
| `--config <path>` | Path to pgmoat.yaml (default: `./pgmoat.yaml`) |
| `--url-env <VAR>` | Read connection URL from environment variable |
| `--json` | Output machine-readable JSON |
| `--no-color` | Disable terminal ANSI color output |
| `-v, --version` | Display version information |
| `-h, --help` | Display command help |

## Subcommands

### `pgmoat start [url]`
Start the MCP server using either stdio or HTTP transport according to `pgmoat.yaml`.
- `--config <path>`: Configuration file path
- `--url-env <VAR>`: Environment variable containing connection string
- `--allow-unsafe-role`: Bypass doctor preflight safety refusal (override recorded in audit)
- `--log-level <level>`: debug, info, warn, error

### `pgmoat init`
Interactive wizard to introspect a Postgres database and generate a safe `pgmoat.yaml` file.
- `-y, --yes`: Accept recommended defaults without interactive prompts
- `--merge`: Merge into existing configuration without overwriting custom annotations

### `pgmoat validate`
Validate `pgmoat.yaml` against the configuration schema and the live database schema.
- `--strict`: Fail with non-zero exit code on warnings

### `pgmoat doctor`
Audit the database role for dangerous privileges (SUPERUSER, CREATEDB, BYPASSRLS, write grants).
- `--strict`: Treat warnings as failures

### `pgmoat audit`
Inspect, query, and verify tamper-evident audit logs.
- `pgmoat audit tail`: Stream newest audit entries in real-time
- `pgmoat audit query`: Filter audit records by date, tool, status, tenant, principal
- `pgmoat audit verify`: Mathematically verify the SHA-256 tamper-evident hash chain
- `pgmoat audit prune`: Safely remove old audit logs beyond retention window

### `pgmoat schema-export`
Export visible schema documentation as Markdown for LLM prompt context.
- `-o, --output <path>`: File destination (defaults to stdout)
- `--include-hidden-count`: Include counts of hidden tables and sensitive columns
