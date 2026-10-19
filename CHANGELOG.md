# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
## [0.1.0] - 2026-11-27

- Initial repository structure, workspace bootstrap, and safety pipeline setup.
### Added

- **Multi-Layer Safety Pipeline**:
  - Fail-closed SQL validation using native PostgreSQL parser `libpg-query`.
  - Prohibits all writes, schema modifications, data manipulation, procedural calls, and administrative statements.
  - Multi-statement detection and statement stacking prevention (`PGM-204`).
  - AST rewrite invariant checking with post-rewrite validation.
- **Access Control & Least Privilege**:
  - Schema allow-listing (`expose` list) and relation visibility enforcement.
  - Table and column masking with identical error disclosure for hidden and missing relations (`PGM-207`, `PGM-208`).
  - Catalog query isolation (`catalogs.allow`) preventing catalog schema enumeration by default.
- **Identity-Bound Row-Level Security (RLS)**:
  - Token-claim RLS mapping verified OAuth 2.0 JWT claims to PostgreSQL session parameters (`SET LOCAL`).
  - Single-transaction session isolation guaranteeing that pooled connections never leak state.
- **Context Budgets & Output Guardrails**:
  - Automatic `LIMIT` injection and enforcement (`max_rows`).
  - Cell truncation (`max_cell_chars`) and untrusted data payload framing.
  - Query character limit budget (`max_sql_chars`).
- **Cryptographic Audit Logging**:
  - Tamper-evident structured NDJSON audit logging.
  - SHA-256 hash chaining linking each entry to its predecessor.
  - Redaction of sensitive values, passwords, and tokens.
- **Transports & Protocols**:
  - Model Context Protocol (MCP) spec 2026-07-28 and 2025-11-25 compatibility.
  - Standard I/O (stdio) transport for Claude Desktop, Claude Code, Cursor, and VS Code.
  - Streamable HTTP server transport with OAuth 2.0 / RFC 9728 Protected Resource Metadata.
  - DNS rebinding prevention via Host and Origin header validation (`PGM-603`).
- **Distribution & Tooling**:
  - Single-file standalone ESM bundle (`packages/cli/dist/bin.mjs`).
  - Multi-architecture Docker image running as non-root user `node` (UID 1000).
  - Claude Desktop bundle (`.mcpb`) with sensitive credential prompt.
  - MCP Registry server definition (`io.github.kitalonlabs/pgmoat`).
  - Public adversarial test corpus with 315 test cases covering all known bypass classes.
  - Starlight documentation site with error directory for all 68 `PGM-xxx` error codes.
