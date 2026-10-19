# Show HN: pgmoat – Governed PostgreSQL MCP server for AI agents

**Title:** Show HN: pgmoat – Governed PostgreSQL MCP server for AI agents

**URL:** https://github.com/kitalonlabs/pgmoat (or https://pgmoat.org)

Hello HN,

Earlier this year, when Anthropic archived the reference `@modelcontextprotocol/server-postgres` package, many teams connecting LLM agents to production or internal databases were left with minimal safety rails. The common workaround was giving an agent a database connection string and trusting the model not to run writes or inspect tables it should not touch.

We built `pgmoat` as an open-source, drop-in replacement that enforces multi-layered governance at the protocol and database boundary.

### How it works

When an agent issues a `query` or `explain` tool call, `pgmoat` processes it through an AST-based safety pipeline before any SQL reaches PostgreSQL:

1. **Native AST Parsing:** Uses `libpg-query` (the actual PostgreSQL 18 C-parser compiled to WebAssembly/Node bindings) to parse the query. It does not use regular expressions or string inspection.
2. **Fail-Closed Classification:** Only `SelectStmt`, `ExplainStmt`, and `VariableShowStmt` are permitted. Multi-statement stacking (`SELECT 1; DROP TABLE users`), writing CTEs (`WITH d AS (DELETE FROM ...) SELECT * FROM d`), and procedures (`CALL`, `DO`) are rejected immediately.
3. **Relation and Column Masking:** Operators define schemas to expose and columns to mask (e.g. `password_hash`, `ssn`). Queries attempting to read masked elements return the identical error as non-existent tables (`PGM-207`), preventing timing and enumeration leaks.
4. **Execution Invariants:** Queries execute inside single-transaction read-only sessions (`BEGIN READ ONLY; SET LOCAL statement_timeout = ...; ROLLBACK;`). Errored connections are destroyed rather than returned to the pool to prevent session contamination.
5. **Token-Claim RLS:** In HTTP mode, OAuth 2.0 JWT claims (e.g. `tenant_id`) are mapped directly to PostgreSQL session variables, enforcing PostgreSQL Row Level Security at the database kernel.
6. **Tamper-Evident Audit:** Outputs structured NDJSON audit events linked by cryptographic SHA-256 hash chains.

### Zero-config drop-in

You can replace the archived server directly:

```bash
# Before:
# npx -y @modelcontextprotocol/server-postgres postgresql://...

# After:
npx -y pgmoat postgresql://user:pass@localhost:5432/app
```

### What pgmoat does not do

We believe safety tools should be explicit about their boundaries:
- It does not prevent prompt injection in data: if an agent reads a ticket containing adversarial instructions and has an external email tool, the model might follow those instructions. `pgmoat` mitigates this by eliminating write paths, hiding restricted tables, and framing data payloads as untrusted.
- It does not replace database role configuration: operators must still grant read-only privileges to the database user.
- It does not fix logically broken RLS policies: it binds session variables from verified tokens, but the PostgreSQL RLS policy logic is owned by the DBA.

We have published an adversarial test corpus with 315 cases covering all known bypass classes in `packages/core/test/corpus/`.

Code: https://github.com/kitalonlabs/pgmoat
Docs: https://pgmoat.org

Feedback, security edge cases, and adversarial queries are welcome.

