# Implementation Plan: pgbridge
Doc owner: Sowad Al-Mughni
Status: Draft
Last updated: 2026-05-12
Companion docs: PRD (01), Feature Spec (02), Technical Architecture (03), TRD (04), Backend Schema (05), UI/UX Design (06), Appflow (07)

This plan sequences pgbridge v1 into atomic, verifiable build phases. It assumes the documentation-first workflow: every prompt references the PRD/Feature Spec/Tech Arch/TRD/Backend Schema/UI-UX/Appflow docs by name and section, includes exact file paths from the Tech Arch §2 repo layout, and ends with a verification block whose pass criteria gates the next prompt.

Build sequence convention follows the four-pass pattern: **v1 build → v2 fix-and-complete → v3 final ship → v4 deferred features**. Phases 0-11 are the v1 build. Phase 12 lists v1.1 deferred work. Phase-level audit prompts (read-only pass/fail report cards) live at the end of each phase as gate prompts.

---

## 1) Timeline and milestone mapping

The PRD targets a 2-week sprint with milestones M0 through M3. Plan calibrated against those targets. Adjust dates linearly if start slips.

| Phase | Window | Outcome | PRD Milestone |
|---|---|---|---|
| P0 Repo bootstrap | Day 0 (target 2026-05-08) | Skeleton on GitHub, CI green, governance files in place | M0 |
| P1 Types + config | Day 1-2 | Zod schema validates fixtures; types compile | - |
| P2 SQL safety pipeline | Day 2-4 | 200-case classify suite passes; parser p95 <2ms | - |
| P3 Postgres execution | Day 4-5 | Real Postgres roundtrip with BEGIN/SET LOCAL/COMMIT works | - |
| P4 Budgets | Day 5-6 | Each budget independently enforced and tested | - |
| P5 Audit pipeline | Day 6-7 | Audit writes to stdout, file, postgres; redaction works | - |
| P6 Schema discovery + tools | Day 7-8 | All 7 read tools execute end-to-end | - |
| P7 MCP server bootstrap | Day 8-9 | Claude Desktop loads pgbridge and lists tools | M1 internal alpha |
| P8 CLI | Day 9-10 | `pgbridge init/start/validate/audit` all work | - |
| P9 Distribution | Day 10-11 | npm + Docker + binaries publishable from CI | - |
| P10 Docs site | Day 11-12 | pgbridge.dev live with quickstart + config + error codes | - |
| P11 Examples + launch polish | Day 12-14 | 5 examples shipped; HN/X drafts ready; YC video shot | M2 public beta → M3 public launch |
| P12 v1.1 deferred | Post-M3 | Scoped-write polish, HTTP/SSE, Datadog/S3, multi-tenant flag | - |

Today (2026-05-12) is Day 4 of the PRD timeline. Phases 0-1 should be done; P2 is in flight. If not, expect M3 to slip by the same number of days.

---

## 2) Prompt format convention

Every Claude Code prompt in this plan follows the structure Sowad uses across Kitalon products:

```
PROMPT P<phase>.<seq>: <title>

SKILL: <skill-name>
DEPENDS: P<x>.<y>, P<x>.<z>
SOURCE: <doc references, e.g. "TRD §FR-READ-01 + Tech Arch §4 + Feature Spec F4">
FILES:
  - packages/core/src/<path>.ts (create)
  - packages/core/tests/<path>.test.ts (create)

GOAL
  One sentence stating the contract this prompt fulfills.

CONTEXT
  - Bullet of relevant constraint from the source docs
  - Bullet of relevant interface contract

IMPLEMENT
  1. Concrete instruction with file paths and class names
  2. Concrete instruction
  3. Concrete instruction

VERIFY
  $ pnpm test packages/core/tests/<path>.test.ts
  Expected: all green, <N> assertions
  $ pnpm tsc --noEmit
  Expected: no errors

DONE WHEN
  All VERIFY commands pass.
  No new ESLint warnings.
```

Atomic means: one file or one closely-coupled file pair (impl + test) per prompt, with a single contract.

---

## 3) Phase 0: Repo bootstrap (Day 0)

### Goal

A public GitHub repo at `github.com/kitalonlabs/pgbridge` with: pnpm workspace, package skeletons, TypeScript+ESLint+Vitest, CI green, MIT LICENSE, README + SECURITY + CONTRIBUTING + GOVERNANCE + CODE_OF_CONDUCT skeletons. Anyone can clone and run `pnpm install && pnpm test`.

### Files created

```
/package.json (workspace root, pnpm)
/pnpm-workspace.yaml
/tsconfig.base.json
/.eslintrc.cjs
/.prettierrc
/.gitignore
/.editorconfig
/LICENSE                        (MIT)
/README.md                      (skeleton)
/SECURITY.md                    (skeleton with security@pgbridge.dev placeholder)
/CONTRIBUTING.md                (DCO sign-off, PR template instructions)
/GOVERNANCE.md                  (current maintainers)
/CODE_OF_CONDUCT.md             (Contributor Covenant 2.1)
/CHANGELOG.md                   (empty Keep-a-Changelog header)
/.github/workflows/ci.yml
/.github/ISSUE_TEMPLATE/bug.md
/.github/ISSUE_TEMPLATE/feature.md
/.github/PULL_REQUEST_TEMPLATE.md
/packages/core/package.json
/packages/core/tsconfig.json
/packages/core/src/index.ts     (empty export)
/packages/cli/package.json
/packages/cli/tsconfig.json
/packages/cli/src/bin.ts        (placeholder)
```

### Prompt sequence

| # | Title | Source |
|---|---|---|
| P0.1 | Initialize pnpm workspace + tsconfig + lint config | Tech Arch §2 |
| P0.2 | Create core + cli package skeletons | Tech Arch §2 |
| P0.3 | Write LICENSE, README skeleton, SECURITY.md, CONTRIBUTING.md, GOVERNANCE.md, CODE_OF_CONDUCT.md | Feat Spec F15 |
| P0.4 | Write GH Actions CI: install, lint, typecheck, test | Tech Arch §11 |
| P0.5 | Write CODEOWNERS, issue templates, PR template | Feat Spec F15 |
| P0.6 | Push to github.com/kitalonlabs/pgbridge; verify CI green | - |

### Phase gate (audit prompt)

```
AUDIT P0: Repo bootstrap readiness

Read-only review. Walk the repo and report on:

  [ ] pnpm install completes cleanly
  [ ] pnpm tsc --noEmit passes in all packages
  [ ] pnpm lint passes
  [ ] pnpm test passes (empty test suite acceptable)
  [ ] CI workflow green on a fresh push
  [ ] All governance files present and non-empty
  [ ] LICENSE is MIT
  [ ] No secrets committed (TruffleHog clean)
  [ ] .gitignore covers /dist, /coverage, /node_modules, *.log

Pass: all 9 checks green.
Fail: list each unchecked item with the file path and exact missing content.
```

---

## 4) Phase 1: Types + config schema (Day 1-2)

### Goal

`packages/core/src/types.ts` defines every interface from Backend Schema §2. `packages/core/src/config/schema.ts` defines the Zod schema from Backend Schema §3. `packages/core/src/config/load.ts` loads YAML, interpolates env vars, validates, and returns a typed config or throws with line/column.

### Files created

```
packages/core/src/types.ts
packages/core/src/errors.ts
packages/core/src/config/schema.ts
packages/core/src/config/load.ts
packages/core/src/config/interpolate.ts
packages/core/tests/config/schema.test.ts
packages/core/tests/config/load.test.ts
packages/core/tests/config/interpolate.test.ts
packages/core/tests/fixtures/configs/valid-minimal.yaml
packages/core/tests/fixtures/configs/valid-full.yaml
packages/core/tests/fixtures/configs/invalid-missing-required.yaml
packages/core/tests/fixtures/configs/invalid-cross-field.yaml
packages/core/tests/fixtures/configs/scoped-write-no-tables.yaml
... (~10 more fixture files for invariant tests)
```

### Prompt sequence

| # | Title | Source |
|---|---|---|
| P1.1 | Write types.ts: SchemaSnapshot, TableInfo, ColumnInfo, RequestContext, AuditEntry, RlsContext, BudgetUsage | Backend Schema §2 |
| P1.2 | Write errors.ts: PgbridgeError class + ErrorCode literal union with all PGB-XXX codes | Backend Schema §4 |
| P1.3 | Write config/schema.ts: Zod definition matching Backend Schema §3 | Backend Schema §3 |
| P1.4 | Write config/schema.ts cross-field invariant refinements (PGB-102 through PGB-106) | Backend Schema §3 |
| P1.5 | Write config/interpolate.ts: ${ENV_VAR} and ${file:path} substitution | TRD FR-CONFIG-02, FR-CONFIG-03 |
| P1.6 | Write config/load.ts: read YAML, interpolate, validate, return PgbridgeConfigT or throw with line/col | TRD FR-CONFIG-01, FR-CONFIG-04 |
| P1.7 | Write 30+ fixture YAMLs covering valid and invalid permutations | TRD verify gate |
| P1.8 | Write tests for schema (valid + each cross-field invariant + ≥20 malformed configs) | TRD QA-01 |

### Phase gate

```
AUDIT P1: Config layer

Read-only review. Verify:

  [ ] Every interface in Backend Schema §2 exists in types.ts with identical field names
  [ ] Every PGB-XXX code in Backend Schema §4 exists in errors.ts ErrorCode union
  [ ] Zod schema in config/schema.ts matches Backend Schema §3 field-by-field
  [ ] All 5 cross-field invariants (PGB-102..106) are tested
  [ ] At least 20 malformed config fixtures fail with the expected error code
  [ ] interpolate.ts handles ${ENV_VAR} and ${file:path}; missing env var emits PGB-108
  [ ] Coverage on packages/core/src/config/ ≥90%

Pass: 7/7.
Fail: list which check failed and the file/line.
```

---

## 5) Phase 2: SQL safety pipeline (Day 2-4)

### Goal

`pg-query-emscripten` integrated; AST classifier rejects 100% of forbidden statements with the right PGB-XXX code; auto-LIMIT injection mutates AST and re-emits SQL via deparse (no string concatenation anywhere).

### Files created

```
packages/core/src/safety/parser.ts
packages/core/src/safety/allowlist.ts
packages/core/src/safety/classify.ts
packages/core/src/safety/rewrite.ts
packages/core/tests/safety/parser.test.ts
packages/core/tests/safety/classify.test.ts
packages/core/tests/safety/rewrite.test.ts
packages/core/tests/fixtures/sql/allowed/*.sql       (~80 files)
packages/core/tests/fixtures/sql/forbidden/*.sql     (~120 files)
packages/core/tests/fixtures/sql/edge-cases/*.sql    (~20 files)
```

### Why this phase matters most

If any prompt in this sequence regresses or misses a case, the agent can run forbidden SQL on production. Pull request review by Sowad MUST be the gate for every change in `safety/`. The 200-case fixture suite is permanent regression armor.

### Prompt sequence

| # | Title | Source |
|---|---|---|
| P2.1 | Add `pg-query-emscripten` dep; write safety/parser.ts thin wrapper | Tech Arch §4 |
| P2.2 | Write safety/allowlist.ts: ALLOWED_TOP_LEVEL_NODES_READONLY, FORBIDDEN_NODES, FORBIDDEN_FUNCTIONS | Feat Spec F4 |
| P2.3 | Write safety/classify.ts: classify() function returning ClassifyResult | Tech Arch §4 |
| P2.4 | Write safety/classify.ts walker: detect forbidden node types | Feat Spec F4 |
| P2.5 | Write safety/classify.ts walker: detect forbidden functions (recursive) | Feat Spec F4 |
| P2.6 | Write safety/classify.ts walker: detect writing CTEs | TRD FR-READ-04 |
| P2.7 | Write safety/classify.ts walker: detect SELECT INTO, FOR UPDATE, FOR SHARE | TRD FR-READ-02, FR-READ-03 |
| P2.8 | Write safety/classify.ts: multi-statement detection | TRD FR-READ-06 |
| P2.9 | Curate 80 allowed SQL fixtures (SELECT variants, CTEs, window fns, joins, pgvector ops) | TRD verify |
| P2.10 | Curate 120 forbidden SQL fixtures (every PGB-2XX path) | TRD verify |
| P2.11 | Curate 20 edge-case fixtures (bracket-quoted IDs, mixed case, escapes) | Feat Spec F4 edge cases |
| P2.12 | Write classify.test.ts: assert every fixture produces the expected ClassifyResult | TRD acceptance |
| P2.13 | Write safety/rewrite.ts: auto-LIMIT injection via AST mutation + deparse | Tech Arch §4 |
| P2.14 | Write rewrite.test.ts: 30+ cases (no LIMIT, with LIMIT < max, with LIMIT > max, with OFFSET) | TRD FR-BUDGET-01, FR-BUDGET-02 |
| P2.15 | Write benchmark: parse + classify on 1KB query in <2ms p95 | TRD NFR-PERF-05 |

### Phase gate

```
AUDIT P2: SQL safety pipeline

Read-only review against the 200-case fixture suite. For each fixture:
  - Note the file path
  - Note expected ClassifyResult (allowed or refused-with-code)
  - Note actual result
  - Note pass/fail

Summary table:
  Allowed fixtures:    80 expected pass, X actual pass
  Forbidden fixtures: 120 expected refuse, X actual refuse
  Edge fixtures:       20 expected as documented, X actual

Pass: 200/200.
Fail: enumerate the diverging fixtures.

Additional gates:
  [ ] No string concatenation into SQL anywhere in safety/ (grep for + and template strings around SQL keywords)
  [ ] rewrite.ts emits SQL only via deparse(), never via string templating
  [ ] Benchmark: parse + classify p95 <2ms on the bench corpus
```

---

## 6) Phase 3: Postgres execution (Day 4-5)

### Goal

`postgres/pool.ts`, `postgres/execute.ts`, `postgres/introspect.ts`, `rls/inject.ts` together produce a working query path: BEGIN, statement_timeout, RLS via `set_config`, query, COMMIT, release. Integration tests use testcontainers.

### Files created

```
packages/core/src/postgres/pool.ts
packages/core/src/postgres/execute.ts
packages/core/src/postgres/introspect.ts
packages/core/src/rls/inject.ts
packages/core/tests/postgres/pool.test.ts
packages/core/tests/postgres/execute.test.ts
packages/core/tests/postgres/introspect.test.ts
packages/core/tests/rls/inject.test.ts
packages/core/tests/integration/setup.ts    (testcontainers Postgres bootstrap)
packages/core/tests/integration/execute.integration.test.ts
packages/core/tests/integration/rls-isolation.integration.test.ts
```

### Prompt sequence

| # | Title | Source |
|---|---|---|
| P3.1 | Write postgres/pool.ts using `pg.Pool` with config-driven settings | Tech Arch §5 |
| P3.2 | Write postgres/introspect.ts: information_schema + pg_catalog queries returning SchemaSnapshot | Tech Arch §5 + Feat Spec F6 |
| P3.3 | Write rls/inject.ts: validate vars + emit set_config($1, $2, true) parameterized | TRD FR-RLS-01, FR-RLS-03 |
| P3.4 | Write postgres/execute.ts: BEGIN, SET LOCAL statement_timeout, RLS, query, COMMIT, ROLLBACK on error | Tech Arch §5 |
| P3.5 | Write testcontainers setup helper | Tech Arch §11 |
| P3.6 | Write integration test: query roundtrip with budgets | TRD FR-BUDGET-03, FR-BUDGET-04 |
| P3.7 | Write integration test: 100 queries alternating tenant A/B never leak rows | TRD FR-RLS-06 |
| P3.8 | Write integration test: SQL injection in tenant_id value is escaped | TRD SEC-INJECT-02 |
| P3.9 | Write integration test: statement timeout cancels query at max_query_ms | TRD FR-BUDGET-04 |

### Phase gate

```
AUDIT P3: Postgres execution

Run integration suite against pg13, pg14, pg15, pg16 in matrix.

  [ ] Every query uses BEGIN/COMMIT (or BEGIN/ROLLBACK on error)
  [ ] set_config uses parameterized form (audit code: no string concat)
  [ ] statement_timeout set before every query
  [ ] RLS isolation test: 100 alternating queries, 0 cross-tenant rows
  [ ] Injection test: tenant_id with SQL payload yields no SQL execution
  [ ] Statement timeout test: query exceeding max_query_ms returns PGB-302 within 1.5x max_query_ms
  [ ] Pool exhaustion: 25 concurrent queries with pool.max=20 queue and complete or timeout cleanly
  [ ] No connection leaks across 1000-iteration loop test

Pass: 8/8.
```

---

## 7) Phase 4: Budgets (Day 5-6)

### Goal

Each budget enforced in its own module, independently tested, and integrated into the query path.

### Files created

```
packages/core/src/budgets/rows.ts
packages/core/src/budgets/time.ts
packages/core/src/budgets/columns.ts
packages/core/src/budgets/payload.ts
packages/core/src/budgets/index.ts
packages/core/tests/budgets/*.test.ts
```

### Prompt sequence

| # | Title | Source |
|---|---|---|
| P4.1 | budgets/rows.ts: auto-LIMIT injection (wraps safety/rewrite); post-execute drop-and-warn | TRD FR-BUDGET-01, FR-BUDGET-02 |
| P4.2 | budgets/time.ts: emit SET LOCAL statement_timeout pre-query; map cancellation to PGB-302 | TRD FR-BUDGET-03, FR-BUDGET-04 |
| P4.3 | budgets/columns.ts: post-query alphabetical truncation with warning emission | TRD FR-BUDGET-05 |
| P4.4 | budgets/payload.ts: serialize-then-check; refuse pre-transmission if over | TRD FR-BUDGET-06 |
| P4.5 | budgets/index.ts: applyBudgets() orchestrator used by query tool | - |
| P4.6 | Tests: each budget unit-tested with ≥5 boundary cases | TRD QA-01 |
| P4.7 | Integration test: SELECT * FROM big_table auto-limits to 1000 rows + warning | TRD FR-BUDGET-01 acceptance |
| P4.8 | Integration test: 50MB query refused with PGB-304 | TRD FR-BUDGET-06 acceptance |

### Phase gate

```
AUDIT P4: Budgets
  [ ] Each budget enforced independently; failure of one does not bypass others
  [ ] Warnings (PGB-301, PGB-303, PGB-305) appended to RequestContext.warnings
  [ ] Errors (PGB-301a, PGB-302, PGB-304) short-circuit and audit-log
  [ ] Coverage on budgets/ ≥90%
  [ ] 4 acceptance tests pass (one per budget)
```

---

## 8) Phase 5: Audit pipeline (Day 6-7)

### Goal

Fire-and-forget audit emit; redaction applied pre-enqueue; destinations write asynchronously; queue overflow drops with CRITICAL alarm; query path unaffected by destination outages.

### Files created

```
packages/core/src/audit/pipeline.ts
packages/core/src/audit/redact.ts
packages/core/src/audit/destinations/stdout.ts
packages/core/src/audit/destinations/file.ts
packages/core/src/audit/destinations/postgres.ts
packages/core/src/audit/destinations/datadog.ts   (skeleton; full impl P12)
packages/core/src/audit/destinations/s3.ts        (skeleton; full impl P12)
packages/core/src/audit/index.ts
packages/core/tests/audit/*.test.ts
packages/core/tests/integration/audit-pipeline.integration.test.ts
```

### Prompt sequence

| # | Title | Source |
|---|---|---|
| P5.1 | audit/redact.ts: redactFields + redactInSql (AST-walking value masker) | Tech Arch §6 + TRD FR-AUDIT-05 |
| P5.2 | audit/pipeline.ts: AuditPipeline class with bounded queue, 100ms flush loop, byte counter | Tech Arch §6 |
| P5.3 | audit/destinations/stdout.ts | Feat Spec F9 |
| P5.4 | audit/destinations/file.ts with daily rotation via pino | Feat Spec F9 |
| P5.5 | audit/destinations/postgres.ts using SEPARATE pool; idempotent CREATE TABLE on startup | Backend Schema §1 |
| P5.6 | audit/index.ts: wire destinations by config.audit.destination | - |
| P5.7 | Tests: redact_fields masks keys (every default field) | TRD FR-AUDIT-05 |
| P5.8 | Tests: redact_in_sql masks literal values when column ref matches | TRD FR-AUDIT-05 |
| P5.9 | Tests: error messages sanitized before audit (Postgres constraint payloads) | TRD FR-AUDIT-06 |
| P5.10 | Integration test: queue overflow drops with stderr CRITICAL alarm | TRD FR-AUDIT-04 |
| P5.11 | Integration test: destination outage does not block query path | TRD FR-AUDIT-08 |
| P5.12 | Integration test: postgres destination idempotent migration | Backend Schema §1 |
| P5.13 | Benchmark: enqueue p95 <1ms | TRD NFR-PERF-04 |

### Phase gate

```
AUDIT P5: Audit pipeline
  [ ] Audit emit is async; bench shows p95 <1ms enqueue
  [ ] 10k emits while destination is down do not block any caller
  [ ] Queue at buffer_max_bytes drops new entries with CRITICAL stderr alarm
  [ ] Postgres destination uses separate pool from query pool (audit code review)
  [ ] redact_fields applied to params + rls_context + SQL (when redact_in_sql)
  [ ] Pg constraint error messages do not leak field values into audit
  [ ] On crash mid-flush, only entries since last flush are lost
```

---

## 9) Phase 6: Schema discovery + tools (Day 7-8)

### Goal

All seven read tools (`list_tables`, `describe_table`, `list_views`, `query`, `explain`, `sample_table`, `count`) implemented end-to-end. Output formatting (Markdown table) handles NULLs, long strings, bytea, JSON.

### Files created

```
packages/core/src/output/markdown-table.ts
packages/core/src/output/format.ts
packages/core/src/tools/list-tables.ts
packages/core/src/tools/describe-table.ts
packages/core/src/tools/list-views.ts
packages/core/src/tools/query.ts
packages/core/src/tools/explain.ts
packages/core/src/tools/sample-table.ts
packages/core/src/tools/count.ts
packages/core/src/tools/index.ts
packages/core/tests/tools/*.test.ts
packages/core/tests/integration/tools.integration.test.ts
```

### Prompt sequence

| # | Title | Source |
|---|---|---|
| P6.1 | output/markdown-table.ts: render rows with column truncation, NULL marker, long-string truncation, bytea, JSON | UI/UX §4 specimens |
| P6.2 | output/format.ts: assemble Markdown + summary lines per UI/UX §4 | UI/UX §4 |
| P6.3 | tools/list-tables.ts: respect hidden, sort, exclude system schemas | Feat Spec F6 |
| P6.4 | tools/describe-table.ts: exclude hidden columns + render sensitivity labels | Feat Spec F6 |
| P6.5 | tools/list-views.ts | Feat Spec F3 |
| P6.6 | tools/query.ts: orchestrate parser → classify → rewrite → budgets → execute → format | TRD FR-PROTO-02, Tech Arch §3 |
| P6.7 | tools/explain.ts: EXPLAIN FORMAT JSON with max_explain_ms cap | Feat Spec F11 |
| P6.8 | tools/sample-table.ts: ORDER BY random() LIMIT 5; TABLESAMPLE on >1M rows; mask sensitive | Feat Spec F12 |
| P6.9 | tools/count.ts: SELECT count(*) FROM <table> [WHERE <conds>] with whitelisted where pattern | Feat Spec F3 |
| P6.10 | tools/index.ts: registerTools() returns array of tool descriptors with descriptions from UI/UX §4 | UI/UX §4 |
| P6.11 | Tests per tool with integration database fixture | TRD acceptance |

### Phase gate

```
AUDIT P6: Tools
  [ ] All 7 tools register with correct names and inputSchema
  [ ] Tool descriptions match UI/UX §4 verbatim
  [ ] Each tool emits exactly one audit entry per call
  [ ] list_tables excludes hidden; describe_table excludes hidden columns
  [ ] sample_table masks sensitive columns; never omits them
  [ ] query passes the full pipeline (parse → classify → rewrite → execute → budgets → format → audit)
  [ ] Markdown output handles NULL, long strings, bytea, JSON per UI/UX §4
```

---

## 10) Phase 7: MCP server bootstrap (Day 8-9, M1 alpha)

### Goal

`packages/core/src/server.ts` wires MCP SDK + tools + audit + config into a runnable server. Stdio transport. Claude Desktop loads it. M1 alpha tag cut.

### Files created

```
packages/core/src/server.ts
packages/core/src/index.ts  (export startServer)
packages/core/tests/integration/mcp.integration.test.ts
packages/core/tests/integration/claude-desktop-mock.test.ts
```

### Prompt sequence

| # | Title | Source |
|---|---|---|
| P7.1 | server.ts: MCP Server setup with capabilities.tools | Tech Arch §7 |
| P7.2 | server.ts: ListToolsRequest handler returning registered tools | Tech Arch §7 |
| P7.3 | server.ts: CallToolRequest handler with audit context, error mapping, RLS extraction | Tech Arch §7 |
| P7.4 | server.ts: extractRls() per Tech Arch §7 with PGB-401 enforcement | TRD FR-RLS-04 |
| P7.5 | server.ts: stdio transport bind + graceful shutdown handlers (SIGTERM drain) | TRD NFR-AVAIL-04 |
| P7.6 | server.ts: cancel-on-disconnect via pg_cancel_backend | TRD FR-PROTO-06 |
| P7.7 | Mock MCP client integration test: full handshake + tool call roundtrip | TRD FR-PROTO-01 |
| P7.8 | Concurrent request test: 100 in-flight calls isolated | TRD FR-PROTO-05 |
| P7.9 | Tag v0.0.1-alpha; verify Claude Desktop loads + lists 7 tools (manual) | M1 |

### Phase gate (M1 alpha gate)

```
AUDIT P7: MCP server
  [ ] Claude Desktop with pgbridge in config loads on launch
  [ ] Tool inspector shows all 7 tools with correct descriptions
  [ ] First end-to-end query (SELECT 1) returns successfully
  [ ] Cancel-on-disconnect verified by killing Claude Desktop mid-query
  [ ] Concurrent test: 100 isolated audit entries from 100 calls
  [ ] SIGTERM drains within 10s
  [ ] v0.0.1-alpha tag pushed
```

---

## 11) Phase 8: CLI (Day 9-10)

### Goal

`pgbridge init/start/validate/audit/schema-export/version` all working per UI/UX §2 transcripts.

### Files created

```
packages/cli/src/bin.ts
packages/cli/src/commands/init.ts
packages/cli/src/commands/start.ts
packages/cli/src/commands/validate.ts
packages/cli/src/commands/audit.ts
packages/cli/src/commands/schema-export.ts
packages/cli/src/commands/version.ts
packages/cli/src/output/format.ts        (color, NO_COLOR, success/error templates)
packages/cli/tests/commands/*.test.ts
```

### Prompt sequence

| # | Title | Source |
|---|---|---|
| P8.1 | cli/bin.ts: commander setup + --help text per UI/UX §2 | UI/UX §2 |
| P8.2 | output/format.ts: error/success template renderers honoring NO_COLOR | UI/UX §2 |
| P8.3 | commands/init.ts: inquirer wizard per UI/UX §2 transcripts | Feat Spec F1 |
| P8.4 | commands/init.ts: schema introspection + YAML emission with TODO placeholders | UI/UX §3 |
| P8.5 | commands/init.ts: existing-config detection (abort/merge/overwrite) | Feat Spec F1 edge cases |
| P8.6 | commands/init.ts: optional Claude annotation suggestion (gated by ANTHROPIC_API_KEY + explicit prompt) | UX-01 open issue |
| P8.7 | commands/start.ts: load config, start server, print banner per UI/UX §2 | UI/UX §2 |
| P8.8 | commands/validate.ts: config + connectivity, --strict mode | TRD FR-CLI-03 |
| P8.9 | commands/audit.ts: tail, prune, query, session subcommands | UI/UX §5 |
| P8.10 | commands/schema-export.ts: emit Markdown representation | TRD FR-CLI-06 |
| P8.11 | commands/version.ts | - |
| P8.12 | Tests: init wizard happy + error paths via input mocking | TRD FR-CLI-01 |
| P8.13 | Tests: validate exit codes 0/1 strict/non-strict | TRD IR-CLI-03 |

### Phase gate

```
AUDIT P8: CLI
  [ ] pgbridge init completes a 50-table schema in <5min (timed manual test)
  [ ] All transcripts in UI/UX §2 reproducible character-for-character
  [ ] Exit codes match IR-CLI-03
  [ ] NO_COLOR honored
  [ ] --json switch produces NDJSON for every command
  [ ] Existing pgbridge.yaml never overwritten without explicit prompt
```

---

## 12) Phase 9: Distribution (Day 10-11)

### Goal

`npm install -g pgbridge`, `npx pgbridge init`, `docker run ghcr.io/kitalonlabs/pgbridge`, and pre-built binaries from GH Releases all work.

### Files created

```
/Dockerfile
/.dockerignore
/scripts/build-binaries.sh
/.github/workflows/release.yml
/.github/workflows/codeql.yml
/packages/core/tsup.config.ts
/packages/cli/tsup.config.ts
```

### Prompt sequence

| # | Title | Source |
|---|---|---|
| P9.1 | tsup configs for core + cli (ESM-only, single-file bundle) | Tech Arch §10 |
| P9.2 | Dockerfile per Tech Arch §10 (alpine, non-root, UID 1000) | Tech Arch §10 + TRD SEC-SUPPLY-05 |
| P9.3 | scripts/build-binaries.sh: pkg-based binaries for darwin/linux/windows | Tech Arch §10 |
| P9.4 | release.yml: tag-triggered publish to npm + GHCR + GH Releases | Tech Arch §10 |
| P9.5 | codeql.yml: security scan on every PR | Tech Arch §8 |
| P9.6 | License-compatibility lint in CI (no copyleft deps) | TRD SEC-SUPPLY-03 |
| P9.7 | TruffleHog secret-scan in CI | TRD SEC-SUPPLY-02 |
| P9.8 | Manual verification on macOS, Ubuntu 22.04, Windows 11 | TRD NFR-COMPAT-02 |

### Phase gate

```
AUDIT P9: Distribution
  [ ] npm install -g pgbridge works on macOS arm64, Linux x64, Windows 11
  [ ] npx pgbridge init works without global install
  [ ] docker run ghcr.io/kitalonlabs/pgbridge:latest --help works
  [ ] Pre-built binaries run without Node installed
  [ ] CI release workflow publishes from a tag push end-to-end on a test tag
  [ ] CodeQL clean; Snyk clean; npm audit clean (no critical/high)
  [ ] All deps MIT/Apache/BSD/ISC
```

---

## 13) Phase 10: Docs site (Day 11-12)

### Goal

`pgbridge.dev` live on Cloudflare Pages. Quickstart + config reference + safety/threat model + every PGB-XXX error-code page + 5 example index pages. Lighthouse >95.

### Files created

```
packages/docs/                       (Astro Starlight)
├── astro.config.mjs
├── src/content/docs/
│   ├── index.mdx                    (landing)
│   ├── getting-started/quickstart.mdx
│   ├── getting-started/install.mdx
│   ├── config/reference.mdx
│   ├── safety/guarantees.mdx
│   ├── safety/threat-model.mdx
│   ├── schema/annotations.mdx
│   ├── rls/multi-tenant.mdx
│   ├── budgets/overview.mdx
│   ├── audit/fields.mdx
│   ├── audit/retention.mdx
│   ├── ops/deployment-patterns.mdx
│   ├── reference/cli.mdx
│   ├── reference/tools.mdx
│   ├── reference/error-codes/PGB-001.mdx
│   ├── ... (one per error code)
│   └── reference/changelog.mdx
```

### Prompt sequence

| # | Title | Source |
|---|---|---|
| P10.1 | Astro Starlight scaffold; sidebar config per UI/UX §6 | UI/UX §6 |
| P10.2 | Landing page per UI/UX §6 layout | UI/UX §6 |
| P10.3 | Quickstart: 5-step copy-pasteable walkthrough | Feat Spec F14 |
| P10.4 | Config reference page generated from Zod schema (script + hand-edit) | UI/UX §3 |
| P10.5 | Safety page: guarantees and explicit non-guarantees | PRD §3 tone |
| P10.6 | Threat model page (Tech Arch §8 table expanded) | Tech Arch §8 |
| P10.7 | Error-code template + one page per code | UI/UX §6 template |
| P10.8 | RLS multi-tenant patterns page | Feat Spec F8 |
| P10.9 | Audit fields + retention pages | Backend Schema §1 |
| P10.10 | CLI reference page (generated from --help) | UI/UX §2 |
| P10.11 | Tools reference page | UI/UX §4 |
| P10.12 | Deploy to Cloudflare Pages on push to main | - |
| P10.13 | Algolia DocSearch integration (free tier) | UX-04 open issue |

### Phase gate

```
AUDIT P10: Docs site
  [ ] pgbridge.dev resolves and serves
  [ ] Lighthouse score >95 on landing, quickstart, config reference
  [ ] All PGB-XXX codes in Backend Schema §4 have a doc page
  [ ] Every doc page has: last-updated date, Edit on GitHub link, right-rail TOC
  [ ] 3 external testers complete quickstart in <5min (recorded)
  [ ] Search returns relevant results for 20 sample queries
```

---

## 14) Phase 11: Examples + launch polish (Day 12-14, M2 → M3)

### Goal

5 reference example projects under `/examples`. README polished. Launch artifacts (HN post draft, X thread, YC demo video) ready. M2 beta tag. M3 launch.

### Files created

```
/examples/vertical-ai-agent/
├── README.md
├── pgbridge.yaml
├── schema.sql
└── agent-prompts.md

/examples/internal-analytics/
/examples/rag-retrieval/
/examples/support-agent/
/examples/customer-success/

/README.md                  (final version)
/SECURITY.md                (final version with PGP key)

/launch/
├── hn-post.md
├── x-thread.md
├── yc-application.md
└── demo-video-script.md
```

### Prompt sequence

| # | Title | Source |
|---|---|---|
| P11.1 | examples/vertical-ai-agent: restaurant phone-AI-style schema + pgbridge.yaml + sample agent prompts | PRD §2 use case 1 |
| P11.2 | examples/internal-analytics: read-only against a sample warehouse schema | PRD §2 use case 2 |
| P11.3 | examples/rag-retrieval: pgvector-equipped schema + retrieval flow | PRD §2 use case 3 |
| P11.4 | examples/support-agent: scoped-write on tickets table | PRD §2 use case 4 |
| P11.5 | examples/customer-success: CRM-style schema + RLS by sales rep | PRD §2 use case 5 |
| P11.6 | Final README per UI/UX style: trust-first, action-verb leads, no em dashes | UI/UX §1 principles |
| P11.7 | Final SECURITY.md: PGP key, disclosure email, 90-day window | TRD SEC-DISCLOSE-01 |
| P11.8 | Launch HN post: title, opening, body, FAQ | PRD §8 rollout |
| P11.9 | X/Twitter launch thread (10-12 tweets) | PRD §8 rollout |
| P11.10 | YC S26 application demo video script (2 min) | PRD §1 goal 2 |
| P11.11 | Apply for modelcontextprotocol.io official servers listing | PRD §11 Q2 |
| P11.12 | Tag v0.1.0 (M2 beta), tag v0.1.0 (M3 public launch) | M2, M3 |

### Phase gate (M3 ship gate, mirrors TRD §9)

```
AUDIT P11: M3 ship gate
  [ ] G1: 100% of P0 TRD requirements pass their verification method
  [ ] G2: 0 P0 bugs, ≤3 P1 bugs open
  [ ] G3: coverage ≥85%
  [ ] G4: NFR-PERF benchmark suite green
  [ ] G5: README quickstart works for 3 external testers
  [ ] G6: 5 examples shipped under /examples with READMEs
  [ ] G7: SECURITY.md final with PGP key + disclosure email
  [ ] G8: npm + GHCR + GH Releases artifacts published for v0.1.0
  [ ] G9: pgbridge.dev live with quickstart + config + error codes + security
  [ ] G10: compatibility verified on macOS Sonoma, Ubuntu 22.04, Windows 11
```

---

## 15) Phase 12: v1.1 deferred (Post-M3, target 2026-06-15)

### Goal

Land Should-have/Could-have features and the items deferred from v1 per PRD §4 and TRD priorities.

### Scope

| Item | Source |
|---|---|
| Scoped-write full implementation (insert/update/delete tools) | Feat Spec F5; TRD FR-WRITE-* |
| Datadog audit destination (full) | TRD FR-AUDIT-02 P1 |
| S3 audit destination (full) | TRD FR-AUDIT-02 P1 |
| `pgbridge schema-export` Markdown emit | TRD FR-CLI-06 |
| `pgbridge audit prune` retention command | TRD FR-AUDIT-07 |
| HTTP/SSE MCP transport | PRD §6 + Tech Arch §13 |
| `--multi-tenant` flag + per-request RLS context flow | Appflow §11 |
| OpenTelemetry exporter (`--otel`) | Tech Arch §12 |
| Prometheus metrics endpoint (`--metrics`) | Tech Arch §12 |
| Annotation auto-suggest via Claude API | PRD §11 Q4 |
| Smart query rewrite hints (R10) | PRD §4 Should |
| Streaming responses for large reads | PRD §16 Q4 |
| Apple notarization on macOS binaries | TRD SEC-SUPPLY-06 |

### Approach

Follow the same phase-gate pattern. Each item gets its own atomic prompt sequence with verify gates. PR-by-PR with traceable TRD IDs in commit messages.

---

## 16) Cross-cutting workstreams

Run continuously through every phase.

| Workstream | Owner | Cadence |
|---|---|---|
| Issue triage | Sowad | Daily 30min from M3 onward |
| PR review | Sowad | <48h SLA per QA-06 |
| Security disclosure response | Sowad | <72h SLA per SEC-DISCLOSE-02 |
| Benchmark regression alerting | CI | Every PR; alarm at >20% regression |
| Dependency vulnerability scan | CI | Every PR |
| Coverage gate | CI | Every PR (≥85%) |

---

## 17) Risk-driven prompt insertion

Insert these prompts opportunistically when the corresponding risk surfaces.

| Risk | Insertion prompt |
|---|---|
| Anthropic ships their own Postgres MCP | Write a blog post differentiating pgbridge on RLS-first + budgets + audit; treat Anthropic's as a tailwind |
| MCP protocol breaks | Insert a CI matrix prompt that pins to current spec version + the prior version |
| Production user reports a CVE-class bug | Insert a coordinated-disclosure prompt: triage, patch, CVE filing, security advisory |
| Schema introspection slow on customer DB | Insert a Q5 prompt for materialized cache + on-disk fallback |
| Audit destination floods (high QPS agent) | Insert a back-pressure tuning prompt: batch size, flush interval, queue size |

---

## 18) Acceptance: when is the plan complete

The plan is complete when, at the M3 gate, every check in §14 phase gate passes AND:

- 1,000+ GitHub stars target tracked at `pgbridge.dev/stats` (PRD §7 goal 1; allow 60d to reach).
- ≥10 production deployments by month 3 (PRD §1 goal 3).
- YC S26 application submitted referencing pgbridge as the AI infrastructure wedge (PRD §1 goal 2).
- v1.1 plan drafted and visible on the public GitHub Projects board (PRD §8 post-launch monitoring).

---

## 19) Open issues

| ID | Question | Owner | Due |
|---|---|---|---|
| IP-01 | Should P2 (SQL safety) be split into two sub-phases (parser+classify, then auto-LIMIT) to allow earlier P3 start in parallel? | Sowad | 2026-05-13 |
| IP-02 | Use Bun for binary builds instead of pkg? Faster builds, but newer; lock to pkg for v1, revisit for v1.1. | Sowad | v1.1 |
| IP-03 | Should P10 docs site ship before or after P9 distribution? Argument for after: docs reference real binary install commands. Current: P10 immediately after P9. | Sowad | 2026-05-13 |
| IP-04 | Outsource Phase 11 example-project authoring to Juwel as Android-style intern tasks? Possible if examples use a constrained YAML+SQL pattern. | Sowad | 2026-05-15 |
| IP-05 | Use Claude Code subagents for the 200-case SQL fixture generation in P2.9-P2.11 (one subagent per category)? Likely yes; faster than serial. | Sowad | 2026-05-13 |
