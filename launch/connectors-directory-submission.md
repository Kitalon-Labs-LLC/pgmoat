# MCP Registry and Connectors Directory Submission

### Server Identifier
`io.github.kitalonlabs/pgmoat`

### Display Name
pgmoat - Governed PostgreSQL MCP Server

### Short Description
Governed read-only PostgreSQL Model Context Protocol (MCP) server for AI agents with AST validation, column masking, and RLS.

### Long Description
pgmoat provides autonomous AI agents with secure, read-only access to PostgreSQL databases. It acts as an AST-level firewall and governance layer, parsing incoming SQL queries using PostgreSQL 18 grammar (libpg-query) and refusing all write statements, administrative operations, statement stacking, and unauthorized catalog inspections. Features include column and relation masking, context budgets, OAuth 2.0 token-claim Row-Level Security (RLS) integration, and cryptographic SHA-256 hash-chained audit logging.

### Categories
- Databases
- Security
- Governance
- Developer Tools

### Repository
https://github.com/kitalonlabs/pgmoat

### Homepage
https://pgmoat.org

### License
MIT

### Supported Transports
- stdio
- streamable-http

### Supported MCP Protocol Versions
- 2026-07-28
- 2025-11-25

### Published Packages
- npm: `pgmoat`
- Docker: `ghcr.io/kitalonlabs/pgmoat`
- MCPB: `pgmoat.mcpb`

