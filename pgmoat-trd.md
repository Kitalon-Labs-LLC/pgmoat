# TRD: pgbridge
Doc owner: Sowad Al-Mughni
Status: Draft
Last updated: 2026-05-12
Companion docs: PRD (01-pgbridge-prd.md), Feature Spec (02-pgbridge-feature-spec.md), Technical Architecture (03-pgbridge-technical-architecture.md)

This Technical Requirements Document distills every requirement pgbridge v1 must satisfy into traceable, measurable, testable units. The PRD answers "what and why." The Feature Spec answers "exactly what each feature does." The Technical Architecture answers "how we build it." This TRD answers "what must be true for v1 to ship, and how do we verify each one."

A reader picking up only this document should be able to (a) understand the full requirements surface, (b) write a verification suite for any single requirement, (c) trace any acceptance test back to a numbered requirement, and (d) audit a future contribution against the v1 contract.

---

## 1) How to read this document

### Requirement ID convention

Every requirement carries a stable ID. IDs never change once shipped (deprecation is allowed; renaming is not). Format:

`<CATEGORY>-<DOMAIN>-<NN>`

| Category | Meaning |
|---|---|
| FR | Functional requirement (the system must do X) |
| NFR | Non-functional requirement (measurable quality target) |
| SEC | Security requirement (threat-driven) |
| COMP | Compliance requirement (audit-driven) |
| IR | Interface requirement (protocol/CLI/config surface) |
| CON | Constraint (immovable platform/runtime fact) |
| QA | Quality attribute (testability, maintainability) |

Example: `FR-READ-03` is the third functional requirement in the read-only enforcement domain.

### Verification method codes

Each requirement specifies how it gets verified:

| Code | Method |
|---|---|
| UT | Unit test (Vitest in `packages/core/tests/`) |
| IT | Integration test (Dockerized Postgres via testcontainers) |
| E2E | End-to-end test (Playwright + Claude Desktop) |
| BENCH | Benchmark suite assertion |
| MAN | Manual checklist verified at release gate |
| AUDIT | Code review or static analysis |
| DOC | Documentation review |

### Priority

| Priority | Meaning |
|---|---|
| P0 | Ship-blocker for M3 (M3 = public launch on 2026-05-26) |
| P1 | Ship target for M3, slip-tolerant to v1.1 if shown trivial |
| P2 | Should land by v1.1 (2026-06-15) |
| P3 | Could land in v1.x |

---

## 2) Functional Requirements

### FR-PROTO: MCP protocol compliance

| ID | Requirement | Priority | Verify | Source |
|---|---|---|---|---|
| FR-PROTO-01 | pgbridge MUST register as a compliant MCP stdio server using `@modelcontextprotocol/sdk` and respond to `initialize`, `tools/list`, `tools/call`, `shutdown` without protocol errors | P0 | IT, E2E | PRD R1, Feat F3 |
| FR-PROTO-02 | pgbridge MUST register at least 7 read tools (`list_tables`, `describe_table`, `list_views`, `query`, `explain`, `sample_table`, `count`) in read-only mode | P0 | IT | Feat F3 |
| FR-PROTO-03 | pgbridge MUST additionally register `insert`, `update`, `delete` tools in scoped-write mode, gated per table allow-list | P1 | IT | Feat F5 |
| FR-PROTO-04 | Each tool MUST emit a deterministic, short description (<400 chars) that includes the mode, safety guidance, and current budgets | P0 | UT | Feat F3 |
| FR-PROTO-05 | Concurrent tool calls MUST be isolated; pgbridge MUST not share transaction state across in-flight requests | P0 | IT | PRD R1 |
| FR-PROTO-06 | Client disconnect mid-query MUST cancel the underlying Postgres query via `pg_cancel_backend` within 1s | P0 | IT | PRD R1 edge cases |
| FR-PROTO-07 | Unknown tool name MUST return a structured error with code `PGB-001` and isError=true | P0 | UT | Feat F3 |
| FR-PROTO-08 | MCP protocol version skew MUST emit a startup warning but not crash | P1 | IT | PRD R1 edge cases |

### FR-READ: Read-only enforcement

| ID | Requirement | Priority | Verify | Source |
|---|---|---|---|---|
| FR-READ-01 | In `read-only` mode, pgbridge MUST refuse any top-level statement other than `SelectStmt`, `ExplainStmt`, `VariableShowStmt` with error `PGB-201` | P0 | UT | PRD R2, Feat F4 |
| FR-READ-02 | pgbridge MUST refuse `SELECT ... INTO` with error `PGB-202` | P0 | UT | Feat F4 |
| FR-READ-03 | pgbridge MUST refuse `SELECT ... FOR UPDATE` and `SELECT ... FOR SHARE` with error `PGB-202` | P0 | UT | Feat F4 |
| FR-READ-04 | pgbridge MUST refuse any CTE whose inner statement is on the FORBIDDEN_NODES list with error `PGB-203` | P0 | UT | Feat F4 |
| FR-READ-05 | pgbridge MUST refuse any query containing a function call on the FORBIDDEN_FUNCTIONS list with error `PGB-205` | P0 | UT | Feat F4 |
| FR-READ-06 | pgbridge MUST refuse multiple-statement queries (split on top-level semicolons) with error `PGB-204` | P0 | UT | Feat F4 |
| FR-READ-07 | Custom user-defined functions MUST default to deny in read-only mode unless explicitly allowed in `extensions.allowed_functions` | P1 | UT | Feat F4 edge cases |
| FR-READ-08 | Parser MUST handle bracket-quoted identifiers, mixed-case names, and double-quoted reserved words via AST walk, never string regex | P0 | UT, AUDIT | Feat F4 edge cases |

### FR-WRITE: Scoped-write enforcement

| ID | Requirement | Priority | Verify | Source |
|---|---|---|---|---|
| FR-WRITE-01 | In `scoped-write` mode, pgbridge MUST refuse writes to any table not listed in `tables.<name>.write` with error `PGB-211`/`PGB-213` | P1 | UT, IT | Feat F5 |
| FR-WRITE-02 | UPDATE MUST refuse any SET column not in `tables.<name>.update_columns` with error `PGB-212` | P1 | UT | Feat F5 |
| FR-WRITE-03 | UPDATE and DELETE MUST refuse empty WHERE or always-true WHERE clauses (e.g., `WHERE 1=1`) with error `PGB-214` | P1 | UT | Feat F5 |
| FR-WRITE-04 | INSERT MUST refuse missing `insert_required_columns` with error `PGB-215` | P1 | UT | Feat F5 |
| FR-WRITE-05 | INSERT MUST auto-merge `insert_default_columns` such that defaults always override agent input | P1 | UT | Feat F5 |
| FR-WRITE-06 | DELETE MUST cap affected rows at `max_affected_rows` (default 100); excess MUST refuse pre-execution where possible | P1 | IT | Feat F5 |
| FR-WRITE-07 | Bulk INSERT >100 rows MUST chunk into batches, each in its own transaction | P2 | IT | Feat F5 edge cases |
| FR-WRITE-08 | All write tools MUST share RLS-injection and audit-logging paths with read tools | P1 | UT | Feat F5, F8, F9 |

### FR-SCHEMA: Schema discovery

| ID | Requirement | Priority | Verify | Source |
|---|---|---|---|---|
| FR-SCHEMA-01 | pgbridge MUST introspect `information_schema` and `pg_catalog` at startup to build a schema snapshot | P0 | IT | Feat F6 |
| FR-SCHEMA-02 | `list_tables` MUST exclude any table with `hidden: true` from all output and metadata | P0 | UT | PRD R4 |
| FR-SCHEMA-03 | `describe_table` MUST exclude any column with `hidden: true` from all output and metadata | P0 | UT | PRD R4 |
| FR-SCHEMA-04 | Schema cache MUST hold a 60-second TTL by default; `--watch` mode MUST reload within 5s of YAML save | P0 | IT | Feat F6 |
| FR-SCHEMA-05 | Tables present in DB but absent from YAML MUST appear with description "Unannotated" and log a warning | P1 | UT | Feat F6 edge cases |
| FR-SCHEMA-06 | Tables present in YAML but absent from DB MUST log a warning and exclude from output | P1 | UT | Feat F6 edge cases |
| FR-SCHEMA-07 | Multiple schemas MUST be supportable via `connection.schema` array (default `["public"]`) | P1 | IT | Feat F6 |
| FR-SCHEMA-08 | `describe_table` output MUST include columns, types, nullability, PK, FKs, indexes, descriptions, sensitivity labels | P0 | UT | PRD R4 |

### FR-BUDGET: Query budgets

| ID | Requirement | Priority | Verify | Source |
|---|---|---|---|---|
| FR-BUDGET-01 | pgbridge MUST inject `LIMIT max_rows + 1` into any SELECT lacking an explicit LIMIT, then drop the extra row and emit warning `PGB-301` | P0 | UT | PRD R5, Feat F7 |
| FR-BUDGET-02 | A SELECT with `LIMIT N` where `N > max_rows` MUST refuse with error `PGB-301a` | P0 | UT | Feat F7 |
| FR-BUDGET-03 | pgbridge MUST issue `SET LOCAL statement_timeout = max_query_ms` before every query | P0 | IT | PRD R5 |
| FR-BUDGET-04 | A query timing out MUST return error `PGB-302` with the elapsed time | P0 | IT | PRD R5 |
| FR-BUDGET-05 | Result rows with >`max_columns` keys MUST drop excess columns alphabetically and emit warning `PGB-303` | P0 | UT | PRD R5 |
| FR-BUDGET-06 | Serialized result exceeding `max_payload_bytes` MUST refuse with error `PGB-304` before transmission | P0 | UT | PRD R5 |
| FR-BUDGET-07 | `EXPLAIN` runtime MUST be capped at `max_explain_ms` (default 500) | P0 | IT | Feat F11 |
| FR-BUDGET-08 | Queries with `OFFSET > 10000` MUST emit warning `PGB-305` (not refuse) | P2 | UT | PRD R5 edge cases |

### FR-RLS: Row-level security

| ID | Requirement | Priority | Verify | Source |
|---|---|---|---|---|
| FR-RLS-01 | When `rls.session_variables` are configured, pgbridge MUST call `set_config($1, $2, true)` for each variable inside the same transaction as the query | P0 | IT | PRD R6, Feat F8 |
| FR-RLS-02 | RLS variable names MUST match regex `[a-zA-Z_][a-zA-Z0-9_.]*` and refuse otherwise at config-load time | P0 | UT | Feat F8 |
| FR-RLS-03 | RLS variable values MUST flow through parameterized `set_config` (no string concatenation) | P0 | UT, AUDIT | SEC-INJECT-02 |
| FR-RLS-04 | When `rls.required: true` and a required key is absent or empty in `_meta.rls_context`, pgbridge MUST refuse with `PGB-401` | P0 | UT | Feat F8 |
| FR-RLS-05 | Variable injection MUST occur after BEGIN and before the user query, so SET LOCAL rolls back on error | P0 | IT | Feat F8 |
| FR-RLS-06 | 100 alternating queries between tenant A and tenant B MUST never leak rows across | P0 | IT | Feat F8 acceptance |

### FR-AUDIT: Audit logging

| ID | Requirement | Priority | Verify | Source |
|---|---|---|---|---|
| FR-AUDIT-01 | Every tool call MUST emit exactly one structured audit entry containing the fields listed in Feature Spec F9 | P0 | UT, IT | PRD R7 |
| FR-AUDIT-02 | Audit MUST support destinations: stdout, file (NDJSON, daily rotation), Postgres table, Datadog, S3 | P0 (stdout, file, postgres), P1 (Datadog, S3) | IT | PRD R7 |
| FR-AUDIT-03 | Audit MUST be asynchronous and never block the query path; enqueue p95 MUST be <1ms | P0 | BENCH | NFR-PERF-04 |
| FR-AUDIT-04 | Audit queue MUST be bounded by `buffer_max_bytes` (default 10MB); overflow MUST drop with stderr CRITICAL alarm | P0 | IT | PRD R7 edge cases |
| FR-AUDIT-05 | `redact_fields` MUST mask matching keys in params, rls_context, and (when `redact_in_sql: true`) in SQL literal values | P0 | UT | PRD R7 |
| FR-AUDIT-06 | Error messages MUST be sanitized before audit log entry (e.g., Postgres constraint-violation payloads) | P0 | UT | Feat F9 edge cases |
| FR-AUDIT-07 | `pgbridge audit prune` command MUST delete files older than `retain_days` | P1 | UT | Feat F9 |
| FR-AUDIT-08 | Audit destination outage MUST NOT crash pgbridge or stall the query path | P0 | IT | Feat F9 edge cases |

### FR-CONFIG: Configuration management

| ID | Requirement | Priority | Verify | Source |
|---|---|---|---|---|
| FR-CONFIG-01 | pgbridge MUST validate `pgbridge.yaml` via Zod schema at startup and refuse to start with line-numbered errors if invalid | P0 | UT | Feat F2 |
| FR-CONFIG-02 | `${ENV_VAR}` interpolation MUST work in any string field; missing required env var MUST fail with a clear error | P0 | UT | PRD §6 |
| FR-CONFIG-03 | `${file:path}` interpolation MUST work for secrets stored as files (Docker/k8s secrets pattern) | P1 | UT | PRD §6 |
| FR-CONFIG-04 | Config search order: `--config` flag, then `./pgbridge.yaml`, then `~/.config/pgbridge/config.yaml`, then `/etc/pgbridge.yaml` | P0 | UT | Feat F2 |
| FR-CONFIG-05 | `--watch` mode MUST reload schema cache within 5s of YAML save; invalid YAML MUST keep the prior valid config and log an error | P1 | IT | Feat F2 |
| FR-CONFIG-06 | Insecure config combinations MUST refuse startup (e.g., `mode: scoped-write` with no table-level write allow-list) | P0 | UT | SEC-DEFAULT-03 |

### FR-CLI: CLI commands

| ID | Requirement | Priority | Verify | Source |
|---|---|---|---|---|
| FR-CLI-01 | `pgbridge init` wizard MUST complete a fresh config in under 5 minutes on a 50-table schema | P0 | E2E, MAN | Feat F1 |
| FR-CLI-02 | `pgbridge init` MUST never overwrite an existing `pgbridge.yaml` without explicit confirmation | P0 | UT | Feat F1 edge cases |
| FR-CLI-03 | `pgbridge validate` MUST verify config against schema and Postgres connectivity, exiting non-zero on any failure | P0 | UT | PRD §3 |
| FR-CLI-04 | `pgbridge start` MUST print a copy-paste-ready Claude Desktop config block | P0 | MAN | Feat F1 |
| FR-CLI-05 | `pgbridge audit prune` MUST delete audit files older than retention with `--dry-run` support | P1 | UT | Feat F9 |
| FR-CLI-06 | `pgbridge schema-export` MUST emit a Markdown representation of the introspected schema for human review | P2 | UT | PRD §3 |
| FR-CLI-07 | All commands MUST support `--json` for machine-readable output | P1 | UT | PRD §3 |
| FR-CLI-08 | Every error MUST include a unique `PGB-XXX` code and link to `pgbridge.dev/docs/error-codes#PGB-XXX` | P0 | AUDIT | PRD §3 |

---

## 3) Non-Functional Requirements

### NFR-PERF: Performance

| ID | Requirement | Target | Verify |
|---|---|---|---|
| NFR-PERF-01 | Overhead vs raw `pg` client for `query` tool | <10ms p95 | BENCH |
| NFR-PERF-02 | `list_tables` end-to-end on 50-table schema | <50ms | BENCH |
| NFR-PERF-03 | `describe_table` end-to-end (warm cache) | <30ms | BENCH |
| NFR-PERF-04 | Audit emit enqueue latency | <1ms p95 | BENCH |
| NFR-PERF-05 | SQL parse + classify on 1KB query | <2ms p95 | BENCH |
| NFR-PERF-06 | Schema introspection cold start (100 tables) | <500ms | BENCH |
| NFR-PERF-07 | Memory baseline RSS | <100MB | BENCH |
| NFR-PERF-08 | Sustained request rate on 4 vCPU / 4GB RAM | ≥500 req/s | BENCH |

### NFR-SCALE: Scalability

| ID | Requirement | Target | Verify |
|---|---|---|---|
| NFR-SCALE-01 | Pool size configurable, default min 2 / max 20 | Settable via YAML | UT |
| NFR-SCALE-02 | Pool exhaustion MUST queue requests with `queue_timeout_ms` (default 3000) before erroring | Behavioral | IT |
| NFR-SCALE-03 | Audit queue MUST batch flush every 100ms when non-empty | Behavioral | UT |
| NFR-SCALE-04 | Schema cache MUST be process-local; no external cache infra required | Architectural | DOC |

### NFR-AVAIL: Availability

| ID | Requirement | Target | Verify |
|---|---|---|---|
| NFR-AVAIL-01 | Process MUST be stateless; restart MUST recover full functionality with no data loss outside the audit in-flight window | Behavioral | IT |
| NFR-AVAIL-02 | Postgres connection loss MUST trigger pool reconnect with exponential backoff (cap 30s) | Behavioral | IT |
| NFR-AVAIL-03 | Audit destination outage MUST NOT impact query availability | Behavioral | IT |
| NFR-AVAIL-04 | SIGTERM MUST drain in-flight requests within 10s before exit | Behavioral | IT |

### NFR-COMPAT: Platform compatibility

| ID | Requirement | Target | Verify |
|---|---|---|---|
| NFR-COMPAT-01 | Node.js runtime | 20 LTS minimum | UT (engines field) |
| NFR-COMPAT-02 | Operating systems | macOS Sonoma+, Ubuntu 22.04+, Windows 11 | E2E, MAN |
| NFR-COMPAT-03 | Postgres versions | 13, 14, 15, 16 | IT matrix |
| NFR-COMPAT-04 | MCP protocol version | Latest stable + immediately prior version | IT matrix |
| NFR-COMPAT-05 | Distribution channels | npm, npx, Docker (GHCR), GH Releases binaries | MAN |

### NFR-RES: Resource limits

| ID | Requirement | Target | Verify |
|---|---|---|---|
| NFR-RES-01 | Bundle size (npm tarball) | <5MB | BENCH |
| NFR-RES-02 | Cold start time | <300ms to "ready for first tool call" | BENCH |
| NFR-RES-03 | File descriptors held | pool.max + log handles + 8 baseline | AUDIT |
| NFR-RES-04 | CPU at idle | <1% on 4 vCPU machine | BENCH |

---

## 4) Security Requirements

### SEC-INJECT: SQL injection prevention

| ID | Requirement | Verify |
|---|---|---|
| SEC-INJECT-01 | All user-supplied SQL MUST flow through `pg-query-emscripten` AST analysis before execution | UT, AUDIT |
| SEC-INJECT-02 | RLS values MUST flow through `set_config($1, $2, true)` parameterized; no string concatenation | UT, AUDIT |
| SEC-INJECT-03 | AST modifications (auto-LIMIT, etc.) MUST round-trip through `deparse()`; the system MUST NEVER concatenate strings into SQL | UT, AUDIT |
| SEC-INJECT-04 | A repo-level lint rule MUST forbid string concatenation patterns matching SQL-shaped templates | AUDIT (CI) |
| SEC-INJECT-05 | Variable names in `set_config` MUST be regex-validated at config-load time | UT |

### SEC-ESCAPE: Escaping and isolation

| ID | Requirement | Verify |
|---|---|---|
| SEC-ESCAPE-01 | Every query MUST run in its own transaction; SET LOCAL state MUST NOT leak across requests | IT |
| SEC-ESCAPE-02 | Connection pool MUST NOT reuse a connection with uncommitted session state | IT |
| SEC-ESCAPE-03 | A connection pooler in front of pgbridge MUST be documented as unsupported (statement-pooling mode breaks SET LOCAL) | DOC |
| SEC-ESCAPE-04 | Multi-tenant alternation test (100 queries, tenant A vs B) MUST show zero cross-tenant rows | IT |

### SEC-DEFAULT: Safe defaults

| ID | Requirement | Verify |
|---|---|---|
| SEC-DEFAULT-01 | Default mode MUST be `read-only` | UT |
| SEC-DEFAULT-02 | Default `audit.destination` MUST be a real destination (file), not "off" | UT |
| SEC-DEFAULT-03 | `scoped-write` with no per-table allow-list MUST refuse startup | UT |
| SEC-DEFAULT-04 | Default `redact_fields` MUST include: password, password_hash, fein, ssn, api_key, token, credit_card | UT |
| SEC-DEFAULT-05 | Default `statement_timeout_ms` MUST be 5000 (never unlimited) | UT |
| SEC-DEFAULT-06 | Default pool `max` MUST be 20 (bounded) | UT |
| SEC-DEFAULT-07 | Telemetry MUST be off by default; opt-in only | UT |

### SEC-AUDIT: Audit integrity

| ID | Requirement | Verify |
|---|---|---|
| SEC-AUDIT-01 | Refusals MUST be logged at the same severity as successes | UT |
| SEC-AUDIT-02 | Audit emission MUST occur even on error path | IT |
| SEC-AUDIT-03 | Audit MUST never block on destination unavailability; CRITICAL alarm to stderr instead | IT |
| SEC-AUDIT-04 | Postgres audit destination MUST be a separate connection from query-execution pool (avoids self-deadlock) | AUDIT, IT |

### SEC-SUPPLY: Supply chain

| ID | Requirement | Verify |
|---|---|---|
| SEC-SUPPLY-01 | All dependencies MUST be pinned via lockfile | AUDIT |
| SEC-SUPPLY-02 | CI MUST run CodeQL, Snyk, npm audit, TruffleHog secret scan on every PR | AUDIT (CI) |
| SEC-SUPPLY-03 | Dependency licenses MUST be MIT, Apache 2.0, BSD, or ISC; copyleft refused | AUDIT (CI) |
| SEC-SUPPLY-04 | Release artifacts MUST be built via GH Actions, not local machines | AUDIT |
| SEC-SUPPLY-05 | Docker images MUST run as non-root (UID 1000) | AUDIT |
| SEC-SUPPLY-06 | Pre-built binaries MUST be code-signed on macOS (Apple notarization v1.1) | MAN |

### SEC-DISCLOSE: Disclosure

| ID | Requirement | Verify |
|---|---|---|
| SEC-DISCLOSE-01 | `SECURITY.md` MUST publish `security@pgbridge.dev`, PGP key, 90-day disclosure window | DOC |
| SEC-DISCLOSE-02 | First-time-to-acknowledge a security report MUST be <72h | MAN |
| SEC-DISCLOSE-03 | Critical-severity CVEs MUST be patched within 7 days of confirmation | MAN |
| SEC-DISCLOSE-04 | CVE filing MUST occur via GitHub Security Advisories | MAN |

---

## 5) Compliance Requirements

| ID | Requirement | Verify |
|---|---|---|
| COMP-SOC2-01 | Audit log content MUST be sufficient to answer "what queries did the agent run, on whose behalf, with what result" for any 90-day window | DOC, IT |
| COMP-SOC2-02 | Audit retention MUST be configurable per `retain_days` | UT |
| COMP-SOC2-03 | `SECURITY.md` MUST document encryption-at-rest expectations for audit destinations (operator responsibility) | DOC |
| COMP-GDPR-01 | Redaction MUST be applied to PII fields in both params and SQL literal values when `redact_in_sql: true` | UT |
| COMP-GDPR-02 | Telemetry payload MUST contain no PII when enabled; documented schema | DOC |
| COMP-HIPAA-01 | Sensitive column flagging (`sensitive: high`, `hidden: true`) MUST be expressible and enforced | UT |
| COMP-PCI-01 | Default `redact_fields` MUST include `credit_card` and `card_number` | UT |
| COMP-DC-01 | Coordinated disclosure process MUST be published and followed | DOC, MAN |

---

## 6) Interface Requirements

### IR-MCP: MCP protocol surface

| ID | Requirement | Verify |
|---|---|---|
| IR-MCP-01 | Transport MUST be stdio in v1; HTTP/SSE deferred to v1.1+ | UT |
| IR-MCP-02 | Tool input schemas MUST be JSON Schema draft-07 compliant | UT |
| IR-MCP-03 | Tool responses MUST include `_meta` with at minimum `request_id` | UT |
| IR-MCP-04 | Error responses MUST set `isError: true` and include `_meta.error_code: "PGB-XXX"` | UT |
| IR-MCP-05 | `_meta.rls_context` MUST be read from request when present | IT |

### IR-CLI: CLI surface

| ID | Requirement | Verify |
|---|---|---|
| IR-CLI-01 | Commands: `init`, `start`, `validate`, `audit`, `schema-export`, `version`, `--help` | UT |
| IR-CLI-02 | Human output MUST be the default; `--json` flag MUST switch to NDJSON | UT |
| IR-CLI-03 | Exit codes: 0 success, 1 user error, 2 system error, 3 config error, 64+ reserved | UT |
| IR-CLI-04 | Color output MUST honor `NO_COLOR` env var | UT |
| IR-CLI-05 | All errors MUST end with `Learn more: pgbridge.dev/docs/error-codes#PGB-XXX` | UT |

### IR-CONFIG: Config file surface

| ID | Requirement | Verify |
|---|---|---|
| IR-CONFIG-01 | Config file format MUST be YAML 1.2 | UT |
| IR-CONFIG-02 | Schema version MUST be declared via top-level `version: 1` | UT |
| IR-CONFIG-03 | Validation errors MUST include line number, column, and the field path | UT |
| IR-CONFIG-04 | All field defaults MUST be documented in `pgbridge.dev/docs/config` | DOC |

### IR-AUDIT: Audit log surface

| ID | Requirement | Verify |
|---|---|---|
| IR-AUDIT-01 | NDJSON format: one JSON object per line, UTF-8 | UT |
| IR-AUDIT-02 | All timestamps MUST be ISO 8601 UTC with millisecond precision | UT |
| IR-AUDIT-03 | Identifiers MUST be ULIDs (sortable, URL-safe) | UT |
| IR-AUDIT-04 | Postgres destination table schema MUST be stable; column additions only, never renames or drops in minor versions | AUDIT |

---

## 7) Constraints

| ID | Constraint | Rationale |
|---|---|---|
| CON-01 | Node.js 20 LTS minimum | LTS through 2026; matches MCP SDK ecosystem |
| CON-02 | Postgres 13 minimum | RLS + `set_config` semantics stable from 12; we add a margin |
| CON-03 | Single-DB connection per pgbridge instance | Multi-DB out of scope for v1; documented in PRD non-goals |
| CON-04 | Stdio MCP transport only in v1 | HTTP/SSE deferred; matches Claude Desktop dominant pattern |
| CON-05 | TypeScript implementation only | Per Tech Arch §1 rationale |
| CON-06 | MIT license | Project positioning per PRD; non-negotiable |

---

## 8) Quality Attributes

| ID | Attribute | Target | Verify |
|---|---|---|---|
| QA-01 | Test coverage | ≥85% lines, ≥80% branches | CI gate |
| QA-02 | TypeScript strict mode | `strict: true`, no implicit any | UT (tsc) |
| QA-03 | Lint clean | ESLint with security plugin, zero warnings | CI gate |
| QA-04 | Public API stability post-1.0 | SemVer strict; breaking changes only in majors | AUDIT |
| QA-05 | Issue triage SLA | <24h first response in first 30 days post-launch | MAN |
| QA-06 | PR review SLA | <48h first review | MAN |
| QA-07 | Documentation coverage | Every error code documented; every config field documented | DOC |
| QA-08 | Example coverage | 5 reference example projects in `/examples` | DOC, MAN |

---

## 9) Acceptance and verification matrix

The launch (M3, 2026-05-26) ships when:

| Gate | Criterion | Verify |
|---|---|---|
| G1 | 100% of P0 requirements pass their verification method | CI + MAN review |
| G2 | 0 P0 bugs open; ≤3 P1 bugs open | GH issue audit |
| G3 | Test coverage ≥85% lines | CI gate |
| G4 | Benchmark suite passes all NFR-PERF targets | CI bench run |
| G5 | README quickstart runs cleanly for 3 fresh external testers | MAN |
| G6 | 5 example projects shipped under `/examples` with their own READMEs | MAN |
| G7 | `SECURITY.md` published with PGP key + disclosure email | MAN |
| G8 | npm + GHCR + GH Releases artifacts published | MAN |
| G9 | `pgbridge.dev` live with quickstart, config reference, error codes, security | MAN |
| G10 | Compatibility verified on macOS Sonoma, Ubuntu 22.04, Windows 11 | MAN |

---

## 10) Out of scope (v1)

Restates PRD non-goals for completeness and traceability:

- Other databases (MySQL, MSSQL, MongoDB, ClickHouse).
- Graphical query builder, admin panel.
- Query optimizer, index advisor.
- Replication, CDC.
- Managed cloud service (deferred to v1.5).
- Custom DSL over SQL.
- LLM eval, agent harness, prompt management.

Any requirement matching these is rejected from v1 with a pointer to the relevant non-goal.

---

## 11) Open issues

| ID | Question | Owner | Due |
|---|---|---|---|
| TRD-OI-01 | Should `redact_in_sql` default to true or false? Argument for true: safer. Argument for false: surprising auto-mutation of log content. | Sowad | 2026-05-15 |
| TRD-OI-02 | Do we ship a `--unsafe-allow-strings` escape hatch for advanced operators, or refuse all string concatenation paths? | Sowad | 2026-05-15 |
| TRD-OI-03 | Should `pgbridge audit prune` be a no-op on Postgres destination (operator's responsibility) or actively delete rows older than retention? | Sowad | 2026-05-20 |
| TRD-OI-04 | Minimum Postgres version: 13 (covers most installs) or 14 (better default RLS UX)? | Sowad | 2026-05-12 |
| TRD-OI-05 | Should `mode: scoped-write` be allowed in v1.0, or held to v1.1 to reduce surface? | Sowad | 2026-05-13 |

---

## 12) Requirement traceability index

Use this when reviewing a PR to confirm it touches the right requirement IDs. Format: `<Feature Spec section>` → `<Requirement IDs>`.

| Feature Spec | TRD requirements |
|---|---|
| F1 init wizard | FR-CLI-01, FR-CLI-02, FR-CONFIG-04 |
| F2 yaml config | FR-CONFIG-01..06, IR-CONFIG-01..04 |
| F3 MCP protocol | FR-PROTO-01..08, IR-MCP-01..05 |
| F4 SQL safety | FR-READ-01..08, SEC-INJECT-01,03,04 |
| F5 scoped-write | FR-WRITE-01..08 |
| F6 schema discovery | FR-SCHEMA-01..08 |
| F7 budgets | FR-BUDGET-01..08, NFR-PERF-01..05 |
| F8 RLS | FR-RLS-01..06, SEC-INJECT-02,05, SEC-ESCAPE-01..04 |
| F9 audit | FR-AUDIT-01..08, SEC-AUDIT-01..04, COMP-SOC2-01..03 |
| F10 query tool | FR-PROTO-04, FR-BUDGET-01..06 |
| F11 explain | FR-BUDGET-07 |
| F12 sample_table | FR-SCHEMA-03 (sensitivity masking) |
| F13 distribution | NFR-COMPAT-01..05, SEC-SUPPLY-01..06 |
| F14 docs site | QA-07, IR-CLI-05 |
| F15 community | SEC-DISCLOSE-01..04, QA-05, QA-06 |

Any PR claiming to implement feature F4 should touch tests for the FR-READ family. Any PR that adds a new error code (PGB-XXX) MUST update both this TRD and the docs site error-codes page.
