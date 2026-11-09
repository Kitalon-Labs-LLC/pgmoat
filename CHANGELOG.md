# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Evidence for the technical report. Nothing in the published package changed.

### Added

- 80 held-out safety cases in `packages/core/test/heldout/`, written after the corpus was frozen (tag `corpus-321-frozen`) and committed before pgmoat ran on them. Run them with `pnpm test:heldout`.
- `tools/readonly-role-baseline.mjs`: runs the corpus (`--set corpus`) or the held-out cases (`--set heldout`) against a least-privilege database role with no pgmoat in front. Recorded results for Postgres 14 to 18 are in `tools/baseline-results/`.
- CI runs the safety corpus and the held-out cases on every push, fails if a held-out decision changes, and reruns the role baseline on Postgres 14 to 18.

## [0.1.2] - 2026-11-07

### Changed

- `pgmoat test-corpus` now runs the full public safety corpus: 321 cases instead of 289, the same cases as the repository's test suite.
- The README describes the startup role check as it behaves: with a `pgmoat.yaml`, pgmoat refuses to start if the role is a superuser (`PGM-701`), has `BYPASSRLS` while row-level security is configured (`PGM-702`), or owns a protected table without `FORCE ROW LEVEL SECURITY` (`PGM-703`), unless you pass `--allow-unsafe-role`. In zero-config mode it warns and continues.
- Security reports now go to sowad@kitalonlabs.com.

## [0.1.1] - 2026-10-25

### Security

- Hidden columns now return the same error as columns that do not exist (`PGM-506: column "x" does not exist`), so an agent can no longer confirm which hidden columns exist by guessing names. The audit log still records these attempts as refused.

### Fixed

- pgmoat now exits after SIGINT or SIGTERM. Before, Ctrl+C, `docker stop`, and MCP clients stopping the server left the process running until it was force-killed.
- `PGM-208` fix text no longer shows an unfilled `<list>` placeholder.

## [0.1.0] - 2026-10-25

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
  - MCP Registry server definition (`io.github.Kitalon-Labs-LLC/pgmoat`).
  - Public adversarial test corpus with 321 test cases covering all known bypass classes.
  - Starlight documentation site with error directory for all 68 `PGM-xxx` error codes.
