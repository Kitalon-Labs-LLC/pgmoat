# X / Twitter Announcement Thread

1/6
Today we are releasing pgmoat v0.1.0: an open-source, governed PostgreSQL MCP server for AI agents.

Anthropic archived @modelcontextprotocol/server-postgres earlier this year. We built pgmoat to give teams safe, drop-in database access for agents.

https://github.com/kitalonlabs/pgmoat

2/6
How it works:
When an agent calls `query`, pgmoat parses the SQL into an AST via libpg-query (Postgres 18 parser) before anything hits the database.

Multi-statement stacking, writing CTEs, administrative commands, and procedures fail closed immediately.

3/6
Visibility controls:
You can mask sensitive columns (salary, ssn, credentials) and restrict schemas.

Attempts to query masked tables return the exact same error as non-existent tables (PGM-207), preventing enumeration attacks and timing leaks.

4/6
Multi-tenant HTTP & RLS:
In HTTP mode, pgmoat validates OAuth 2.0 JWT tokens and maps claims directly to PostgreSQL session variables (`SET LOCAL`).

PostgreSQL Row Level Security handles the rest at the database kernel.

5/6
Audit logging:
Every query, classification, and refusal is recorded in structured NDJSON linked by SHA-256 hash chains to detect tampering or record omission.

6/6
pgmoat is available on npm (`npx -y pgmoat`), Docker (`ghcr.io/kitalonlabs/pgmoat`), and the MCP Registry.

Docs: https://pgmoat.org
Code: https://github.com/kitalonlabs/pgmoat
Adversarial corpus (315+ cases): https://github.com/kitalonlabs/pgmoat/tree/main/packages/core/test/corpus

