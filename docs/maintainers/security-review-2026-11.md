# Security Review and Findings Register (November 2026)

This document records the comprehensive security self-review of `pgmoat` v1.0.0, evaluating architectural integrity, parser failure modes, session state isolation, information leakage, dependency supply chain, and alignment with the OWASP Top 10 for Agentic Applications.

## Executive Summary

- **Total Findings**: 3 (0 Critical, 0 High, 2 Medium, 1 Low).
- **Core Security Invariant**: 100% of SQL executed against downstream PostgreSQL instances originates from AST-validated and rewritten syntax within single-transaction, read-only sessions (`SET TRANSACTION READ ONLY`).
- **Target Assessment**: PASS. All critical and high vulnerability classes are eliminated by architectural design.

---

## Findings Register

| ID | Area | Finding | Severity | Evidence | Recommendation & Remediation |
|---|---|---|---|---|---|
| **SEC-2026-01** | Denial of Service | Very large SQL queries (> 64 KB) consume CPU time in parser | Medium | `packages/core/src/safety/pipeline.ts:35` | Enforce `max_sql_chars` budget prior to parsing; rejects inputs exceeding limit with `PGM-206` immediately. Completed in P4. |
| **SEC-2026-02** | Session State | Client attempting session parameter modification via `SET` | Medium | `packages/core/src/safety/classify.ts:46` | AST classifier rejects all `VariableSetStmt` nodes with `PGM-201`. Transaction-level session variables use `SET LOCAL` within isolated transactions. Resolved in P2/P3. |
| **SEC-2026-03** | Error Disclosure | Postgres driver connection failures may include raw socket errors | Low | `packages/core/src/postgres/pool.ts:88` | Error formatting redacts embedded database passwords and connection URIs before returning JSON-RPC errors. Resolved in P8. |

---

## Detailed Review Areas

### 1. Tool Input to Database Execution Path
- **Audit**: Inspected `packages/core/src/tools/query.ts` and `packages/core/src/tools/explain.ts`.
- **Proof**: Every tool call unconditionally routes input through `runSafety()` in `packages/core/src/safety/pipeline.ts`.
- **Verification**: If `allowed` is false, query execution is immediately aborted and error `PGM-xxx` is returned. If `allowed` is true, execution uses the rewritten query string verified by AST re-parse invariant assertion.

### 2. SQL Construction and String Building
- **Audit**: Checked all source files in `packages/core/src/` for string concatenation or template literal construction.
- **Rule**: No SQL queries executed on behalf of clients use raw string concatenation. Introspection queries in `packages/core/src/postgres/introspect.ts` use static, hardcoded parameterized queries.

### 3. Parser Failure Modes and Resource Limits
- **Input Size**: `max_sql_chars` budget defaults to 65,536 characters; oversized inputs are refused without invoking the parser.
- **Nesting and Stacking**: Multi-statement payloads (`PGM-204`), deeply nested subqueries, and non-Select statements are refused by the grammar traversal.

### 4. Session State Isolation
- **Transaction Guarantee**: All client queries run inside an explicit transaction:
  ```sql
  BEGIN READ ONLY;
  SET LOCAL statement_timeout = ...;
  -- executed query
  ROLLBACK;
  ```
- **Connection Health**: Errored connections or broken transactions are immediately discarded from the connection pool (`pool.destroy`), preventing state pollution across pooled clients.

### 5. Information Disclosure and Timing Leaks
- **Hidden vs Unknown Relations**: Policy checks return `PGM-207` ("relation does not exist or access is forbidden") identically whether a table is undisclosed or genuinely absent.
- **Hidden Columns**: Column references to forbidden columns return `PGM-208` without disclosing table schema or secret values.
- **Whole-Row & Wildcard Shield**: Wildcard `*` and whole-row records (`to_jsonb(table)`) on tables with hidden columns fail closed with `PGM-208`.

### 6. Dependency Supply Chain Security
- **Pinned Dependencies**: All package versions are strictly pinned with exact versions in `pnpm-lock.yaml`.
- **Minimal Native Surface**: Only `libpg-query` uses native bindings, vetted against upstream Postgres 18 grammar.
- **Packaging Integrity**: Published artifacts use npm 2FA with provenance (`id-token: write`) and multi-arch OCI containers running as non-root UID 1000.

---

## OWASP Top 10 for Agentic Applications Mapping

| OWASP Agentic Risk | pgmoat Mitigation |
|---|---|
| **ASI-01 Prompt Injection** | Structured data isolation: model instructions embedded in database records cannot execute SQL or break out of data payload framing. |
| **ASI-02 Insecure Output Handling** | Result cell truncation (`max_cell_chars`) and row budgeting (`max_rows`) prevent context exhaustion attacks. |
| **ASI-03 Excessive Agency** | Read-only enforcement (`SelectStmt` only, `READ ONLY` transaction mode) eliminates destructive write capabilities. |
| **ASI-05 Improper Resource Consumption** | Statement timeout (`statement_timeout_ms`) and SQL size limits prevent denial of service. |
| **ASI-07 Data Exposure** | Column masking, schema allow-listing, and RLS session parameter binding prevent horizontal and vertical privilege escalation. |
| **ASI-08 Insecure Plugin / Tool Integration** | Standard MCP protocol integration with RFC 9728 Protected Resource Metadata and DNS rebinding protections. |

