# Vertical AI Agent Example

This example demonstrates deploying `pgmoat` as a governed stdio server for an enterprise or domain-specific AI assistant.

## Architecture

- **Transport**: Standard I/O (stdio) integrated into an AI agent runtime.
- **Access Control**: Schema allow-listing (`public`) and sensitive column masking.
- **Hidden Fields**: Employee `salary` and `ssn` columns are blocked at the AST level before queries ever reach PostgreSQL.
- **Resource Limits**: Strict row limit (50 rows) and 2000 ms statement timeout.

## Directory Structure

- `docker-compose.yml`: Spawns a PostgreSQL 17 test database.
- `seed.sql`: Creates `departments`, `employees`, and `projects` tables.
- `pgmoat.yaml`: Governed server configuration with column masking rules.
- `client.mjs`: Node.js MCP client demonstrating safe queries and blocked sensitive column access.

## Quickstart

1. Start the PostgreSQL instance:
   ```bash
   docker compose up -d
   ```

2. Run the client verification script:
   ```bash
   node client.mjs
   ```

3. Clean up:
   ```bash
   docker compose down -v
   ```

