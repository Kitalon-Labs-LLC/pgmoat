# Internal Analytics Example

This example demonstrates deploying `pgmoat` against a read replica or analytics warehouse for business intelligence and data science agents.

## Architecture

- **Use Case**: Read-only reporting, aggregate metrics, and data exploration.
- **Resource Limits**: Higher row budget (1,000 rows) and extended timeout (10,000 ms) to support complex joins and aggregations.
- **Catalog Access**: Enabled (`catalogs.allow: true`) so agents can discover schemas, tables, and column metadata via standard `pg_catalog` queries.
- **Audit Logging**: Emits tamper-evident structured NDJSON logs to a local file (`analytics-audit.log`).

## Directory Structure

- `docker-compose.yml`: Spawns a PostgreSQL 17 analytics warehouse container.
- `seed.sql`: Populates event streams and daily rollup tables.
- `pgmoat.yaml`: Analytics-oriented configuration.
- `client.mjs`: Node.js test script verifying aggregations and catalog introspection.

## Quickstart

1. Start the database:
   ```bash
   docker compose up -d
   ```

2. Run the analytics client:
   ```bash
   node client.mjs
   ```

3. Clean up:
   ```bash
   docker compose down -v
   ```

