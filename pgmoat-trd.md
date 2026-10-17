# TRD: pgmoat

Doc owner: Sowad Al-Mughni (Kitalon Labs)
Status: Draft v2 (supersedes pgbridge TRD v1)
Last updated: 2026-10-17
Companion docs: 01 PRD, 02 Feature Spec, 03 Technical Architecture, 05 Backend Schema

This Technical Requirements Document turns the PRD and Feature Spec into traceable, testable requirements. The PRD says what and why; the Feature Spec says exactly what each feature does; the Tech Arch says how; this TRD says what must be true to ship and how each item is verified.

---

## 1) Conventions

### 1.1 IDs

`<CATEGORY>-<DOMAIN>-<NN>`. IDs are stable once published; deprecate, never renumber.

| Category | Meaning |
|---|---|
| FR | Functional requirement |
| NFR | Non-functional requirement (measurable) |
| SEC | Security requirement |
| COMP | Compliance-supporting requirement |
| IR | Interface requirement (protocol, CLI, config, audit format) |
| CON | Constraint |
| QA | Quality attribute |

### 1.2 Verification methods

| Code | Method |
|---|---|
| UT | Unit test (Vitest) |
| CO | Corpus case (Vitest corpus runner) |
| IT | Integration test (Testcontainers Postgres + MCP client) |
| PT | Property test (fast-check) |
| BENCH | Benchmark assertion |
| AUDIT | Code review or static analysis rule |
| DOC | Documentation review |
| MAN | Manual release checklist |

### 1.3 Priority

| Priority | Meaning |
|---|---|
| P0 | Blocks v1.0 launch (2026-12-08) |
| P1 | Target for v1.0; may slip to v1.1 with sign-off |
| P2 | v1.1 (2027-01-26) |
| P3 | Later |

---

## 2) Functional requirements

### FR-PROTO: MCP protocol

| ID | Requirement | P | Verify | Source |
|---|---|---|---|---|
| FR-PROTO-01 | Serve MCP over stdio using SDK v2 `serveStdio` with `legacy: 'serve'`, supporting protocol 2026-07-28 and 2025-11-25 | P0 | IT | R1, F4 |
| FR-PROTO-02 | Register exactly five tools in v1.0 read-only mode, in alphabetical order: `describe_table`, `explain`, `list_tables`, `query`, `sample_table` | P0 | IT | R1, F4 |
| FR-PROTO-03 | `tools/list` output is byte-identical across calls for the same config | P0 | IT | R1 |
| FR-PROTO-04 | Every tool declares `title`, `description`, `inputSchema`, `outputSchema`, `annotations` | P0 | UT | R22 |
| FR-PROTO-05 | Read tools set `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`; `idempotentHint: true` except `sample_table` | P0 | UT | R22 |
| FR-PROTO-06 | Server `instructions` include mode, budgets, recommended tool order, and the untrusted-data rule | P0 | UT | R20 |
| FR-PROTO-07 | Concurrent tool calls use separate connections and transactions and produce separate audit entries | P0 | IT | R1 |
| FR-PROTO-08 | Client abort cancels the backend query within 2 s and records `canceled` / PGM-505 | P0 | IT | R1 |
| FR-PROTO-09 | Unknown tool returns PGM-001; schema-invalid arguments return PGM-004 | P0 | UT | R1 |
| FR-PROTO-10 | Refusal and error results set `isError: true` and include `_meta` keys `com.kitalonlabs.pgmoat/error_code` and `com.kitalonlabs.pgmoat/request_id` | P0 | UT | F11 |
| FR-PROTO-11 | No bytes other than protocol messages are written to stdout in stdio mode | P0 | IT | F1, F4 |
| FR-PROTO-12 | Graceful shutdown on stdin EOF, SIGTERM, SIGINT: drain up to 10 s, flush audit up to 5 s | P0 | IT | R8 |

### FR-ZERO: Zero-config and compatibility

| ID | Requirement | P | Verify | Source |
|---|---|---|---|---|
| FR-ZERO-01 | `pgmoat <url>` without a config file starts read-only with Backend Schema 05 section 3.3 defaults | P0 | IT | R23 |
| FR-ZERO-02 | `--url-env <VAR>` and `PGMOAT_DATABASE_URL` supply the URL without argv exposure | P0 | UT | R23 |
| FR-ZERO-03 | `query` accepts `{ sql }` like the archived reference server | P0 | IT | R23 |
| FR-ZERO-04 | Zero-config prints a single stderr notice with mode, table count, budgets, audit path, doctor summary, next step | P0 | IT | F1 |

### FR-READ: Read-only enforcement

| ID | Requirement | P | Verify | Source |
|---|---|---|---|---|
| FR-READ-01 | Parse all SQL with libpg-query 18; parse failure, empty input, or over `max_sql_chars` gives PGM-206 | P0 | UT, CO | R2 |
| FR-READ-02 | Exactly one statement, else PGM-204 | P0 | CO | R2 |
| FR-READ-03 | Top-level type in {SelectStmt, ExplainStmt, VariableShowStmt}, else PGM-201 | P0 | CO | R2 |
| FR-READ-04 | Any forbidden node type anywhere gives PGM-201, or PGM-203 inside a CTE | P0 | CO | R2 |
| FR-READ-05 | Unknown node types not on the reviewed expression list fail closed with PGM-201 | P0 | UT | R2 |
| FR-READ-06 | `intoClause` or `lockingClause` gives PGM-202 | P0 | CO | R2 |
| FR-READ-07 | Functions must be on the allow-list; never-allowed list cannot be overridden; else PGM-205 | P0 | CO | R2 |
| FR-READ-08 | `EXPLAIN` with ANALYZE gives PGM-209 | P0 | CO | R2 |
| FR-READ-09 | Execution uses `BEGIN READ ONLY` | P0 | IT | R2 |
| FR-READ-10 | Agent SQL executes only through `pg-cursor` (extended protocol), so Postgres rejects multiple commands | P0 | IT | R2 |
| FR-READ-11 | For every refused write in the corpus, a database-layer test proves Postgres also rejects it when called directly | P0 | CO, IT | R2, R24 |
| FR-READ-12 | No safety decision depends on string matching of SQL text | P0 | AUDIT | R2 |

### FR-POLICY: Query-time access policy

| ID | Requirement | P | Verify | Source |
|---|---|---|---|---|
| FR-POLICY-01 | References to hidden relations give PGM-207 | P0 | CO | R18 |
| FR-POLICY-02 | References to relations outside `connection.schemas` or not in the snapshot give PGM-207 | P0 | CO | R18 |
| FR-POLICY-03 | Catalog schema references give PGM-207 unless `allow_catalog_queries: true` | P0 | CO | R18 |
| FR-POLICY-04 | Hidden column references give PGM-208 | P0 | CO | R18 |
| FR-POLICY-05 | Whole-row references to relations with hidden columns give PGM-208 | P0 | CO | R18 |
| FR-POLICY-06 | `*` and `t.*` over relations with hidden columns give PGM-208 with the allowed column list | P0 | CO | R18 |
| FR-POLICY-07 | CTE names shadow relations within their scope | P0 | CO | R18 |
| FR-POLICY-08 | Error messages for hidden and unknown relations are identical (no existence leak) | P0 | UT | R18 |
| FR-POLICY-09 | `policy.allowed_functions` enables schema-qualified user functions only | P1 | CO | R18 |

### FR-REWRITE: Rewrite and invariants

| ID | Requirement | P | Verify | Source |
|---|---|---|---|---|
| FR-REWRITE-01 | Inject `LIMIT max_rows + 1` when absent on the top-level SELECT | P0 | UT, CO | R5 |
| FR-REWRITE-02 | Constant LIMIT above `max_rows` gives PGM-302 | P0 | CO | R5 |
| FR-REWRITE-03 | All rewrites go through AST mutation and `pgsql-deparser`; no string building | P0 | AUDIT | R2 |
| FR-REWRITE-04 | Deparsed SQL is re-parsed and re-classified; any difference except the LIMIT gives PGM-210 | P0 | UT, PT | R2 |
| FR-REWRITE-05 | Fingerprint strips constants and is stable across whitespace and literal changes | P1 | UT | F10 |

### FR-SCHEMA: Discovery and annotations

| ID | Requirement | P | Verify | Source |
|---|---|---|---|---|
| FR-SCHEMA-01 | Introspect relations, columns, keys, indexes, RLS flags, owners from `pg_catalog` for exposed schemas | P0 | IT | R4 |
| FR-SCHEMA-02 | Hidden relations and columns are removed from every tool-facing structure | P0 | UT | R4 |
| FR-SCHEMA-03 | `list_tables` includes views with `kind`, sorted, with `hidden_count` | P0 | IT | F7 |
| FR-SCHEMA-04 | `describe_table` returns the fields in F7; `referenced_by` excludes hidden relations | P0 | IT | F7 |
| FR-SCHEMA-05 | Unannotated relations show "Unannotated" and log a startup warning | P0 | UT | R4 |
| FR-SCHEMA-06 | Cache TTL default 60 s; single-flight refresh; failure keeps previous snapshot | P0 | UT | F7 |
| FR-SCHEMA-07 | `--watch` applies annotation changes within 5 s; invalid YAML keeps the old config | P1 | IT | R4 |

### FR-BUDGET: Budgets

| ID | Requirement | P | Verify | Source |
|---|---|---|---|---|
| FR-BUDGET-01 | Defaults per Backend Schema 05: 200 rows, 5000 ms, 500 ms explain, 1000 ms lock, 50 columns, 65,536 bytes, 500 chars per cell | P0 | UT | R5 |
| FR-BUDGET-02 | Cursor reads at most `max_rows + 1` rows regardless of SQL shape | P0 | IT | R5 |
| FR-BUDGET-03 | Over-cap results return `max_rows` rows and PGM-301 | P0 | IT | R5 |
| FR-BUDGET-04 | `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout` set with `set_config(..., true)` per transaction | P0 | IT | R5 |
| FR-BUDGET-05 | Timeout and lock timeout map to PGM-303 | P0 | IT | R5 |
| FR-BUDGET-06 | Columns over `max_columns` truncated alphabetically with PGM-304 | P0 | UT | R5 |
| FR-BUDGET-07 | Cells over `max_cell_chars` truncated with PGM-307 | P0 | UT | F8 |
| FR-BUDGET-08 | Serialized structured result over `max_payload_bytes` gives PGM-305 | P0 | UT | R5 |
| FR-BUDGET-09 | Constant OFFSET above `offset_warning` adds PGM-306 | P2 | UT | F8 |

### FR-RLS: Identity-bound RLS

| ID | Requirement | P | Verify | Source |
|---|---|---|---|---|
| FR-RLS-01 | Sources supported: `token.<claim>`, `env.<VAR>`, `static:<value>`, `meta.<key>` | P0 | UT | R6 |
| FR-RLS-02 | `meta.*` only with stdio and `trust_request_meta: true` (PGM-112); `token.*` only with HTTP OAuth (PGM-113) | P0 | UT | R6 |
| FR-RLS-03 | Variables set with `SELECT set_config($1, $2, true)` after BEGIN and before the query | P0 | IT | R6 |
| FR-RLS-04 | `required` refuses missing (PGM-401), empty or non-scalar (PGM-403), missing claim (PGM-405) before any database contact | P0 | UT, IT | R6 |
| FR-RLS-05 | Untrusted meta present gives PGM-404 | P0 | UT | F9 |
| FR-RLS-06 | 1,000 alternating-tenant queries show zero cross-tenant rows | P0 | IT | R6 |
| FR-RLS-07 | Session variables are not visible on the pooled connection after the transaction ends | P0 | IT | R6 |

### FR-AUDIT: Audit

| ID | Requirement | P | Verify | Source |
|---|---|---|---|---|
| FR-AUDIT-01 | Exactly one entry per tool call, including refusals, errors, cancellations | P0 | UT, IT | R7 |
| FR-AUDIT-02 | Destinations `file`, `stderr`, `postgres` in v1.0; `stdout` only with HTTP | P0 | IT | R7 |
| FR-AUDIT-03 | Hash chain per instance with `prev_hash`, `entry_hash`, `seq` | P0 | UT | R7 |
| FR-AUDIT-04 | `audit verify` detects edits, deletions, reordering; reports recorded drops separately | P0 | UT | R7 |
| FR-AUDIT-05 | Redaction of keys, SQL literals, patterns, and Postgres error details before hashing and writing | P0 | UT | R7 |
| FR-AUDIT-06 | Enqueue never blocks over 1 ms p95; overflow drops with stderr CRITICAL and a recorded counter | P0 | BENCH, IT | R7 |
| FR-AUDIT-07 | Postgres destination uses a separate pool; DDL idempotent; batched inserts with bound parameters | P0 | IT | R7 |
| FR-AUDIT-08 | File destination: NDJSON, daily rotation, mode 0600, per-OS default path | P0 | IT | F10 |
| FR-AUDIT-09 | `audit tail`, `audit query`, `audit prune` work for the file destination; `audit query` and `verify` work for Postgres | P1 | IT | F10 |
| FR-AUDIT-10 | Datadog, S3, OpenTelemetry destinations | P2 | IT | R26 |

### FR-DOCTOR: Role preflight

| ID | Requirement | P | Verify | Source |
|---|---|---|---|---|
| FR-DOCTOR-01 | Checks PGM-701 to PGM-707 as specified in Tech Arch 03 section 6.4 | P0 | IT | R21 |
| FR-DOCTOR-02 | `start` with a config file refuses on fail findings unless `--allow-unsafe-role`; zero-config warns | P0 | IT | R21 |
| FR-DOCTOR-03 | `--allow-unsafe-role` sets `unsafe_role_override: true` on every audit entry | P0 | UT | R21 |
| FR-DOCTOR-04 | Each finding includes a copy-paste fix | P0 | UT | F14 |

### FR-AUTH: HTTP transport and OAuth

| ID | Requirement | P | Verify | Source |
|---|---|---|---|---|
| FR-AUTH-01 | Stateless Streamable HTTP on `http.host:port` + `http.path`, default 127.0.0.1:8787/mcp | P1 | IT | R19 |
| FR-AUTH-02 | Non-loopback bind without OAuth refused (PGM-114) | P1 | UT | R19 |
| FR-AUTH-03 | Protected Resource Metadata served at `/.well-known/oauth-protected-resource` | P1 | IT | R19 |
| FR-AUTH-04 | JWT validated for signature (JWKS), issuer, audience equal to canonical URL, expiry, not-before | P1 | IT | R19 |
| FR-AUTH-05 | 401 with `WWW-Authenticate` (resource_metadata, scope) for missing or invalid token | P1 | IT | R19 |
| FR-AUTH-06 | 403 `insufficient_scope` when required scopes missing | P1 | IT | R19 |
| FR-AUTH-07 | Host and Origin validation; 403 on mismatch | P1 | IT | R19 |
| FR-AUTH-08 | Tokens never forwarded, logged, or stored | P1 | AUDIT, UT | R19 |
| FR-AUTH-09 | Request body limit (default 1 MB), 413 over limit | P1 | IT | F15 |

### FR-OUTPUT: Output

| ID | Requirement | P | Verify | Source |
|---|---|---|---|---|
| FR-OUTPUT-01 | Row results return `structuredContent` that validates against the tool's `outputSchema` | P0 | UT, CO | R22 |
| FR-OUTPUT-02 | Text rendering wraps rows in the fixed preamble and `<<<pgmoat:data ...>>>` / `<<<pgmoat:end>>>` fence | P0 | UT | R20 |
| FR-OUTPUT-03 | Fence strings inside data are escaped | P0 | UT | R20 |
| FR-OUTPUT-04 | `bigint` and `numeric` as strings; `bytea` summarized; NULL distinct from empty | P0 | UT | F11 |
| FR-OUTPUT-05 | `untrusted` columns flagged in structured output and listed in text | P0 | UT | R20 |

### FR-CLI: CLI

| ID | Requirement | P | Verify | Source |
|---|---|---|---|---|
| FR-CLI-01 | Commands: zero-config, `init`, `start`, `validate`, `doctor`, `audit` (tail, query, verify, prune), `schema-export`, `test-corpus`, `version` | P0 | UT | R25 |
| FR-CLI-02 | `init` completes on a 50-table schema in under 5 minutes interactively and under 10 s with `--yes` | P0 | MAN, IT | F2 |
| FR-CLI-03 | `init` never overwrites without confirmation; `--merge` preserves edits | P0 | UT | F2 |
| FR-CLI-04 | `--json` on every command emits NDJSON | P1 | UT | F17 |
| FR-CLI-05 | Every error includes a PGM code and docs URL | P0 | AUDIT, UT | R25 |
| FR-CLI-06 | Exit codes 0, 1, 2, 3 as specified in F17 | P0 | UT | F17 |

### FR-CORPUS: Adversarial corpus

| ID | Requirement | P | Verify | Source |
|---|---|---|---|---|
| FR-CORPUS-01 | At least 300 cases across the groups in F18 | P0 | CO | R24 |
| FR-CORPUS-02 | Runs on every push (pipeline mode) and against Postgres 15 to 18 (database mode) | P0 | CO | R24 |
| FR-CORPUS-03 | `test-corpus` runs locally in an isolated, auto-dropped schema and refuses non-disposable-looking databases without `--force` | P0 | IT | F18 |
| FR-CORPUS-04 | Every known bypass class in PRD section 14.1 has at least one case | P0 | DOC, CO | R24 |

### FR-DIST: Distribution

| ID | Requirement | P | Verify | Source |
|---|---|---|---|---|
| FR-DIST-01 | npm package `pgmoat` with provenance, `bin: pgmoat`, `mcpName: io.github.kitalonlabs/pgmoat` | P0 | MAN | R9 |
| FR-DIST-02 | Docker image on GHCR, multi-arch, non-root | P0 | MAN | R9 |
| FR-DIST-03 | MCPB bundle with sensitive `database_url` user config, installs on macOS and Windows Claude Desktop | P0 | MAN | R9 |
| FR-DIST-04 | MCP Registry entry published from CI with a valid `server.json` | P0 | MAN | R9 |
| FR-DIST-05 | Single-file binaries via Node SEA after the WASM spike | P2 | MAN | R28 |

### FR-WRITE: Scoped writes (v1.1)

| ID | Requirement | P | Verify | Source |
|---|---|---|---|---|
| FR-WRITE-01 | Per-table `insert`, `update`, `delete` tools with structured inputs | P2 | IT | R3 |
| FR-WRITE-02 | Column allow-lists, required columns, injected defaults, non-empty WHERE, affected-row cap (PGM-211 to PGM-217) | P2 | UT, IT | R3 |
| FR-WRITE-03 | Human confirmation via `input_required` elicitation; refuse with PGM-218 if unsupported or declined | P2 | IT | R3 |

---

## 3) Non-functional requirements

### NFR-PERF

| ID | Requirement | Target | Verify |
|---|---|---|---|
| NFR-PERF-01 | `query` overhead over raw `pg` | < 10 ms p95 | BENCH |
| NFR-PERF-02 | Parse + classify + policy, 1 KB SQL | < 3 ms p95 | BENCH |
| NFR-PERF-03 | `list_tables`, 100 relations, warm | < 50 ms | IT |
| NFR-PERF-04 | `describe_table`, warm | < 30 ms | IT |
| NFR-PERF-05 | Cold start to ready, 100 relations | < 1 s | BENCH |
| NFR-PERF-06 | Audit enqueue | < 1 ms p95 | BENCH |
| NFR-PERF-07 | HTTP throughput on 2 vCPU / 2 GB, `SELECT 1` | 300 req/s, p95 < 50 ms | BENCH |
| NFR-PERF-08 | Idle RSS with 200 relations | < 150 MB | BENCH |

### NFR-REL

| ID | Requirement | Verify |
|---|---|---|
| NFR-REL-01 | Process is stateless; restart restores full function; only unflushed audit (100 ms window) can be lost | IT |
| NFR-REL-02 | Pool reconnect with exponential backoff capped at 30 s | IT |
| NFR-REL-03 | Audit destination outage does not affect query success | IT |
| NFR-REL-04 | Errored connections are destroyed, never reused | IT |

### NFR-COMPAT

| ID | Requirement | Verify |
|---|---|---|
| NFR-COMPAT-01 | Node `>=22.12.0`; CI on 22, 24, 26 | CI |
| NFR-COMPAT-02 | Postgres 15, 16, 17, 18 (19 after GA and parser support) | CI matrix |
| NFR-COMPAT-03 | macOS 14+, Ubuntu 22.04+, Windows 11 | MAN |
| NFR-COMPAT-04 | MCP protocol 2026-07-28 and 2025-11-25 | IT |
| NFR-COMPAT-05 | Clients: Claude Desktop, Claude Code, Cursor, VS Code, MCP Inspector | MAN |
| NFR-COMPAT-06 | Hosted Postgres: Supabase, Neon, RDS, Cloud SQL, Azure Flexible Server (doctor and query smoke test) | MAN |

### NFR-RES

| ID | Requirement | Target |
|---|---|---|
| NFR-RES-01 | npm tarball size | < 3 MB (excluding dependencies) |
| NFR-RES-02 | Runtime dependencies (not bundled) | `libpg-query`, `pg`, `pg-cursor` only |
| NFR-RES-03 | Idle CPU | < 1% on 2 vCPU |

---

## 4) Security requirements

### SEC-INJECT

| ID | Requirement | Verify |
|---|---|---|
| SEC-INJECT-01 | All agent SQL passes the safety pipeline before any database call | UT, AUDIT |
| SEC-INJECT-02 | Values (RLS, budgets, audit inserts) are always bound parameters | UT, AUDIT |
| SEC-INJECT-03 | Lint rule `no-sql-string-building` enabled with zero violations outside documented exceptions | AUDIT (CI) |
| SEC-INJECT-04 | Table names from tool arguments are resolved against the snapshot and emitted only through AST `RangeVar` nodes | UT |

### SEC-ISOLATION

| ID | Requirement | Verify |
|---|---|---|
| SEC-ISO-01 | One transaction per tool call; transaction-local settings only | IT |
| SEC-ISO-02 | Agent SQL cannot change session state (`SET`, `set_config`, `RESET`, `DISCARD` refused) | CO |
| SEC-ISO-03 | Docs state that statement-mode poolers in front of pgmoat are unsupported | DOC |

### SEC-DEFAULT

| ID | Requirement | Verify |
|---|---|---|
| SEC-DEFAULT-01 | Default mode `read-only`; `scoped-write` refused in v1.0 | UT |
| SEC-DEFAULT-02 | Default audit destination `file` | UT |
| SEC-DEFAULT-03 | Default HTTP bind 127.0.0.1 | UT |
| SEC-DEFAULT-04 | Default `allow_catalog_queries: false`, `trust_request_meta: false` | UT |
| SEC-DEFAULT-05 | Telemetry off by default | UT |
| SEC-DEFAULT-06 | `doctor.on_start: enforce` when a config file exists | UT |

### SEC-AUTH

| ID | Requirement | Verify |
|---|---|---|
| SEC-AUTH-01 | Audience must match the canonical URL; mismatched tokens rejected | IT |
| SEC-AUTH-02 | Algorithms restricted to an allow-list; `none` never accepted | UT |
| SEC-AUTH-03 | Bearer tokens accepted only in the `Authorization` header | UT |
| SEC-AUTH-04 | JWKS fetched over HTTPS with caching and cooldown | UT |

### SEC-AUDIT

| ID | Requirement | Verify |
|---|---|---|
| SEC-AUDIT-01 | Refusals and errors logged like successes | UT |
| SEC-AUDIT-02 | Separate audit pool and recommended append-only role | DOC, IT |
| SEC-AUDIT-03 | Chain covers stored (redacted) content | UT |

### SEC-SUPPLY

| ID | Requirement | Verify |
|---|---|---|
| SEC-SUPPLY-01 | Lockfile committed; `pnpm install --frozen-lockfile` in CI | CI |
| SEC-SUPPLY-02 | CodeQL, dependency review, and secret scanning on every PR | CI |
| SEC-SUPPLY-03 | Dependency licenses limited to MIT, Apache-2.0, BSD, ISC | CI |
| SEC-SUPPLY-04 | Releases built only in GitHub Actions with npm provenance | CI |
| SEC-SUPPLY-05 | Docker image runs as non-root | MAN |
| SEC-SUPPLY-06 | MCPB bundle signed with `mcpb sign` | MAN |

### SEC-DISCLOSE

| ID | Requirement | Verify |
|---|---|---|
| SEC-DISCLOSE-01 | SECURITY.md lists security@kitalonlabs.com, PGP key, 90-day window | DOC |
| SEC-DISCLOSE-02 | Acknowledge reports within 72 h | MAN |
| SEC-DISCLOSE-03 | Patch critical issues within 72 h of confirmation, high within 7 days | MAN |
| SEC-DISCLOSE-04 | Advisories and CVEs via GitHub Security Advisories | MAN |

---

## 5) Compliance-supporting requirements

| ID | Requirement | Verify |
|---|---|---|
| COMP-01 | Audit answers who (principal), what (tool, SQL), for whom (RLS context), when, and outcome for any period retained | DOC, IT |
| COMP-02 | Integrity evidence via `audit verify` exportable with query results | IT |
| COMP-03 | Configurable retention for file audit; documented retention recipes for Postgres | DOC |
| COMP-04 | PII redaction defaults cover passwords, secrets, tokens, SSN, card numbers | UT |
| COMP-05 | Hidden and sensitive column controls documented for HIPAA and PCI scoping conversations (pgmoat makes no certification claim) | DOC |

---

## 6) Interface requirements

| ID | Requirement | Verify |
|---|---|---|
| IR-MCP-01 | stdio (v1.0 P0) and Streamable HTTP (v1.0 P1); no HTTP+SSE | IT |
| IR-MCP-02 | Schemas are JSON Schema 2020-12 (SDK converts Zod) | UT |
| IR-MCP-03 | Custom `_meta` keys use prefix `com.kitalonlabs.pgmoat/` | UT |
| IR-CLI-01 | Human output default; `--json` NDJSON; `NO_COLOR` honored | UT |
| IR-CONFIG-01 | YAML 1.2; `version: 1`; validation errors include path, line, column | UT |
| IR-AUDIT-01 | NDJSON one object per line, UTF-8, snake_case | UT |
| IR-AUDIT-02 | Timestamps ISO 8601 UTC with milliseconds; IDs ULID | UT |
| IR-AUDIT-03 | `pgmoat.audit` schema changes are additive within 1.x | AUDIT |

---

## 7) Constraints

| ID | Constraint |
|---|---|
| CON-01 | TypeScript on Node; MIT license |
| CON-02 | Postgres only; one database per process |
| CON-03 | Parser grammar is Postgres 18 until libpg-query ships 19 |
| CON-04 | pgmoat is an OAuth resource server only, never an authorization server |
| CON-05 | No telemetry without explicit opt-in |

---

## 8) Quality attributes

| ID | Attribute | Target |
|---|---|---|
| QA-01 | Coverage | 85% lines overall, 90% lines on `packages/core/src/safety`, enforced in CI |
| QA-02 | Type safety | `strict: true`, `noUncheckedIndexedAccess: true`, no `any` in `safety/` |
| QA-03 | Lint | Zero warnings |
| QA-04 | Docs | Every error code and config field documented (CI check) |
| QA-05 | Examples | Five runnable examples with READMEs |
| QA-06 | Issue response | < 24 h first 30 days post-launch |

---

## 9) Ship gate (v1.0, 2026-12-08)

| Gate | Criterion | Verify |
|---|---|---|
| G1 | All P0 requirements pass | CI + review |
| G2 | P1 requirements pass or have signed slip notes | Review |
| G3 | Corpus 100% on Postgres 15 to 18 | CI |
| G4 | Coverage gates met | CI |
| G5 | NFR-PERF targets met | Bench |
| G6 | 0 open P0 bugs, at most 3 P1 | Issues |
| G7 | Quickstart verified by 3 external testers in under 5 minutes | MAN |
| G8 | Doctor validated on vanilla, Supabase, Neon, RDS | MAN |
| G9 | npm, GHCR, MCPB, MCP Registry published | MAN |
| G10 | Docs live: quickstart, migration, config, safety, security, errors | MAN |

---

## 10) Traceability

| Feature | Requirements |
|---|---|
| F1 Zero-config | FR-ZERO-01..04, FR-PROTO-11 |
| F2 init | FR-CLI-02, FR-CLI-03 |
| F3 Config | IR-CONFIG-01, SEC-DEFAULT-* |
| F4 Stdio server | FR-PROTO-01..12 |
| F5 Safety | FR-READ-01..12, FR-REWRITE-01..04, SEC-INJECT-*, SEC-ISO-02 |
| F6 Policy | FR-POLICY-01..09 |
| F7 Discovery | FR-SCHEMA-01..07 |
| F8 Budgets | FR-BUDGET-01..09 |
| F9 RLS | FR-RLS-01..07 |
| F10 Audit | FR-AUDIT-01..10, SEC-AUDIT-*, COMP-01..04 |
| F11 to F13 Tools | FR-PROTO-04..05, FR-OUTPUT-* |
| F14 Doctor | FR-DOCTOR-01..04 |
| F15 HTTP | FR-AUTH-01..09, SEC-AUTH-* |
| F16 Output | FR-OUTPUT-01..05 |
| F17 CLI | FR-CLI-01..06 |
| F18 Corpus | FR-CORPUS-01..04 |
| F19 Distribution | FR-DIST-01..05, SEC-SUPPLY-* |
| F22 Writes | FR-WRITE-01..03 |

Every pull request names the TRD IDs it implements or affects in its description. Adding an error code updates Backend Schema 05 section 4, `errors.ts`, and the docs page in the same PR.
