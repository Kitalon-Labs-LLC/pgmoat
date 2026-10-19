# Multi-Tenant HTTP Server with OAuth & RLS

This example demonstrates running `pgmoat` as a centralized, multi-tenant Streamable HTTP server secured by OAuth 2.0 Bearer tokens and PostgreSQL Row Level Security (RLS).

## Architecture

- **Transport**: Streamable HTTP endpoint compliant with MCP specification 2026-07-28.
- **Authentication**: Validates OAuth 2.0 JWTs against a JWKS endpoint (RFC 7517, RFC 9728).
- **Tenant Isolation**: Maps the verified JWT claim (`token.tenant_id`) directly to a session parameter (`app.current_tenant`) inside a single-transaction connection session.
- **PostgreSQL RLS**: Enforces row-level visibility in PostgreSQL kernel (`tenant_id = current_setting('app.current_tenant', true)`), guaranteeing that client agents cannot see rows belonging to other tenants even if they omit filtering conditions.

## Directory Structure

- `docker-compose.yml`: Spawns a PostgreSQL 17 database with RLS policies enabled on `tenant_documents`.
- `seed.sql`: Populates isolated records for `tenant_alpha` and `tenant_beta`.
- `pgmoat.yaml`: Configures HTTP server, JWKS discovery, and token-claim RLS session variable mapping.
- `mock-oidc.mjs`: Lightweight mock OIDC identity provider issuing signed RS256 JWT tokens.
- `client.mjs`: Client script demonstrating token retrieval, PRM discovery, and RLS-enforced queries.

## Quickstart

1. Start the database service:
   ```bash
   docker compose up -d
   ```

2. Run the client test:
   ```bash
   node client.mjs
   ```

3. Clean up:
   ```bash
   docker compose down -v
   ```

