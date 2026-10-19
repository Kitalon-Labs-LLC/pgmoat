# LinkedIn Announcement Post

Connecting AI agents to enterprise relational databases requires strict, deterministic boundaries.

When Anthropic archived the reference @modelcontextprotocol/server-postgres implementation, many engineering teams were left without an actively maintained solution offering built-in governance.

Today, Kitalon Labs is releasing pgmoat: an open-source, governed PostgreSQL Model Context Protocol (MCP) server.

Key capabilities:
- Native AST SQL Safety: Validates queries with libpg-query, strictly preventing statement stacking, data writes, and procedure execution before queries reach the database.
- Column & Relation Masking: Conceal sensitive credentials, tokens, and PII without leaking schema structure through error differences.
- Identity-Bound Row-Level Security: Automatically bind OAuth 2.0 JWT claims to PostgreSQL session parameters for strict multi-tenant isolation.
- Cryptographic Audit Trail: Record immutable, SHA-256 hash-chained NDJSON audit logs for compliance and observability.
- Zero-Config Drop-in: Swap commands from the archived server with zero code changes.

pgmoat is available via npm (npx -y pgmoat), Docker, Claude Desktop bundle (.mcpb), and the MCP Registry.

Explore the project on GitHub: https://github.com/kitalonlabs/pgmoat
Documentation and Guides: https://pgmoat.org

