# Research findings and change log: pgmoat v2

Doc owner: Sowad Al-Mughni (Kitalon Labs)
Status: Final for handoff
Last updated: 2026-10-17
Purpose: Record what changed in the world between the v1 specs (May 2026) and today, what we verified, how confident we are, and exactly what changed in each document as a result.

Confidence tags used below:
- [Certain]: verified directly (official spec, package registry, source code, primary source).
- [Likely]: strong inference from reputable secondary sources or partial primary evidence.
- [Guessing]: plausible but unverified; treat as a hypothesis to confirm.

---

## 1) Summary of what changed

The v1 doc set (PRD, Feature Spec, Technical Architecture, plus TRD, Backend Schema, UI/UX, Appflow, Implementation Plan) was written in May 2026 and never built. Five months later:

1. The MCP protocol made a breaking architectural change (stateless core, 2026-07-28).
2. The MCP TypeScript SDK shipped v2 with new package names and APIs.
3. Several runtime and library choices in v1 became wrong or outdated (Node 20 end of life, the `pg-query-emscripten` parser, `pkg` binaries, Postgres 13 end of life).
4. The security picture sharpened: the reference server's read-only bypass and the Supabase prompt-injection incident showed which threats matter. v1's design had gaps against both.
5. Competitors shipped parts of the idea.
6. The name "pgbridge" turned out to collide with an active Postgres tool, so the product is now **pgmoat**.

Net effect: the product idea holds, but the security model, protocol layer, stack, goals, and timeline all changed. Every document was rewritten, not patched.

---

## 2) Findings

### 2.1 Protocol and SDK

| # | Finding | Confidence | Impact on pgmoat |
|---|---|---|---|
| F1 | MCP spec 2026-07-28 removed the `initialize` handshake and protocol-level sessions. Each request carries protocol version and client capabilities in `_meta`. The spec states a stdio process "is not a conversation or session." | [Certain] | v1's `session_id` (from the initialize handshake) is invalid. Replaced with `instance_id` (per process) plus per-request fields. |
| F2 | Servers must implement `server/discover`; results carry a required `resultType`; `tools/list` should be deterministic and carries `ttlMs`/`cacheScope`. | [Certain] | Tool order fixed (alphabetical); descriptions deterministic. SDK v2 handles the envelope. |
| F3 | Logging, Sampling, and Roots features deprecated; servers should log to stderr (stdio) or OpenTelemetry. | [Certain] | Logs and audit never use MCP logging; stderr only. |
| F4 | Elicitation is now a multi-round-trip pattern (`input_required` results) instead of server-initiated requests. | [Certain] | v1.1 write confirmation uses `inputRequired.elicit` from SDK v2. |
| F5 | `clientInfo` and similar `_meta` values are self-reported and must not drive security decisions. | [Certain] | Tenant identity from client `_meta` is only allowed in trusted stdio setups. |
| F6 | `_meta` custom keys need a reverse-DNS prefix; prefixes whose second label is `modelcontextprotocol` or `mcp` are reserved. | [Certain] | pgmoat uses `com.kitalonlabs.pgmoat/rls`. |
| F7 | Authorization over HTTP: server is an OAuth 2.1 resource server, must publish Protected Resource Metadata (RFC 9728), must validate audience (RFC 8707), must not pass tokens through. Stdio servers should take credentials from the environment. | [Certain] | New HTTP auth design (R19). |
| F8 | HTTP+SSE transport formally deprecated; Streamable HTTP is the remote transport. | [Certain] | HTTP mode uses Streamable HTTP, stateless. |
| F9 | MCP TypeScript SDK v2 is the stable line: `@modelcontextprotocol/server` 2.3.1 (Oct 2026), `McpServer.registerTool(name, {title, description, inputSchema, outputSchema, annotations}, cb)`, `serveStdio(factory, { legacy: 'serve' })` serves both 2025-era and 2026-07-28 clients, Zod v4 schemas, Node 20+. Streamable HTTP via `NodeStreamableHTTPServerTransport` from `@modelcontextprotocol/node`. | [Certain] (read from installed package type definitions) | All MCP code targets SDK v2. v1 code samples (`@modelcontextprotocol/sdk`, `Server`, `setRequestHandler`) are obsolete. |
| F10 | Claude announced rollout of 2026-07-28 support "soon" without per-surface dates. | [Certain] | pgmoat must support both eras; CI tests both. |
| F11 | MCP is governed by the Linux Foundation's Agentic AI Foundation. | [Likely] | Reduces protocol-ownership risk. |

### 2.2 Runtime and libraries

| # | Finding | Confidence | Impact |
|---|---|---|---|
| F12 | Node 20 reached end of life (March/April 2026). Node 22 and 24 are LTS; Node 26 is Current and enters LTS around late October 2026. From Node 27, releases become annual. | [Certain] for status; [Likely] for the Node 26 LTS date | Engines `>=22.12.0`; develop on 24; CI matrix 22, 24, 26. |
| F13 | `libpg-query` 18.1.5 parses the Postgres 18 grammar (WASM, no native build). AST shape is `{ version, stmts: [{ stmt: { SelectStmt: ... } }] }`, not v1's `RawStmt` wrapper. | [Certain] (verified by running it) | Parser choice changes from `pg-query-emscripten`. All AST code in v1 is wrong on shape. |
| F14 | `pgsql-deparser` 18.3.12 deparses ASTs in pure TypeScript; verified LIMIT injection round trip. | [Certain] | Auto-LIMIT via AST mutation plus deparse, then re-parse and re-classify as an invariant check. |
| F15 | `query_to_xml('select ...')` parses as an ordinary `FuncCall` inside a `SelectStmt`. | [Certain] | A deny-list design misses SQL-executing functions; v2 uses an allow-list plus a permanent deny list. |
| F16 | `EXPLAIN ANALYZE DELETE ...` parses as `ExplainStmt` with an `analyze` option and inner `DeleteStmt`. | [Certain] | `ANALYZE` refused; inner statement always classified. |
| F17 | `SELECT u FROM users u` parses as a `ColumnRef` naming the table alias (whole-row reference). | [Certain] | Hidden-column enforcement must catch whole-row references. |
| F18 | TypeScript 7.0.2 (native compiler) is current. SDK v2 notes TypeScript 6+ needs `"types": ["node"]`. | [Certain] | TS 7 with that setting. |
| F19 | Current versions: zod 4.6, vitest 5.0 (Node 22.12+), tsdown 0.23, pino 10, commander 15, pg 8.23, pg-cursor 2.22, jose 6.2, testcontainers 12.2, fast-check 4.10, eslint 10, typescript-eslint 8.71, pnpm 12.14, Astro 7.4, Starlight 0.42, `@anthropic-ai/mcpb` 2.1. | [Certain] (npm registry, 2026-10-17) | Pinned in Tech Arch section 1. |
| F20 | `vercel/pkg` is archived; tsdown's `exe` option builds Node SEA binaries but needs Node 25.7+ to build and is experimental; WASM embedding inside SEA is not documented. | [Certain] for pkg; [Likely] for tsdown; [Guessing] whether libpg-query WASM loads inside SEA | Binaries moved to v1.1 behind a verification spike. |
| F21 | Postgres 13 reached end of life Nov 2025; Postgres 14 ends 2026-11-12; Postgres 19 RC1 released 2026-10-15 with GA planned for October 2026. | [Certain] | Support matrix 15 to 18; add 19 after GA. Parser lags PG19 grammar; fail closed. |

### 2.3 Security

| # | Finding | Confidence | Impact |
|---|---|---|---|
| F22 | Datadog (Aug 2025): reference Postgres MCP server's read-only transaction was bypassed with `COMMIT; <statement>` because the driver accepted multiple statements; also session-state abuse via `SET` on pooled connections. Recommended: prepared statements (single statement), destroying session state, restricted roles. Server archived 2025-05-29; published package unpatched; about 15k to 21k weekly downloads. | [Certain] | Layered read-only defense (R2); the drop-in replacement wedge (R23). |
| F23 | Supabase MCP (Jul 2025): prompt injection in a support ticket caused an agent running as `service_role` (bypasses RLS) to read a private token table and write it back where the attacker could see it. "Lethal trifecta": private data, untrusted content, exfiltration path. | [Certain] | Untrusted-data framing (R20); role preflight for BYPASSRLS (R21); honest non-guarantee in docs. |
| F24 | v1 defaulted audit to stdout in places (PRD, Tech Arch). In stdio transport, stdout carries JSON-RPC; writing logs there corrupts the protocol. | [Certain] | `stdout` audit refused under stdio (`PGM-111`); default is file. |
| F25 | v1 "hidden" tables and columns were only removed from discovery; the agent could still `SELECT` them by name. v1's threat model accepted this. | [Certain] (from v1 text) | Query-time access policy (R18). |
| F26 | v1's function check was a deny list in the Tech Arch but an allow list in the Feature Spec (inconsistent). | [Certain] | Allow list everywhere, plus a permanent deny list. |
| F27 | v1 executed without `READ ONLY` transactions and did not force single-statement execution at the protocol level. | [Certain] | Both added. |
| F28 | OWASP Top 10 for Agentic Applications published Dec 2025 (ASI01 to ASI10). | [Certain] | Threat model mapped to ASI IDs in Tech Arch section 8. |
| F29 | Claude Code warns on MCP tool output above about 10k tokens and truncates around 25k by default. | [Likely] | Budget defaults cut to 200 rows and 64 KB. |

### 2.4 Distribution

| # | Finding | Confidence | Impact |
|---|---|---|---|
| F30 | Official MCP Registry (preview) publishes metadata via `mcp-publisher`; npm packages need `mcpName` in `package.json` matching `server.json` `name` (`io.github.<org>/<name>` with GitHub auth). | [Certain] | `io.github.kitalonlabs/pgmoat`; publish step in release workflow. |
| F31 | MCPB bundles (`@anthropic-ai/mcpb`, `mcpb init` / `mcpb pack`) install in one click in Claude Desktop, which ships Node. Connectors Directory submission requires tool annotations on all tools. | [Certain] | MCPB is a launch artifact; all tools annotated (R22). |
| F32 | OpenAI's Apps SDK requires `readOnlyHint`, `destructiveHint`, `openWorldHint` on tools. | [Likely] | Same annotations satisfy both ecosystems. |

### 2.5 Market

| # | Finding | Confidence | Impact |
|---|---|---|---|
| F33 | Postgres MCP Pro (crystaldba) acquired by Temporal (Sept 2025); defaults to unrestricted; development largely stalled. | [Likely] (Bytebase, Oct 2026) | Opening for a maintained, safe-by-default option. |
| F34 | pgguard-mcp (v0.1.0, July 2026, TypeScript, MIT): libpg-query 17 parsing, allow-lists, `SET LOCAL ROLE`, JSONL audit, row and size caps, 6 tools. Marked stale. | [Likely] (directory listing) | Closest competitor; validates the approach; v2 differentiates on identity binding, corpus, doctor, hash chain, distribution. |
| F35 | pgconsole (Apache-2.0, about 149 stars): parses every statement, default-deny rights, agent identities, shared audit. | [Likely] | Heavier product (a console); different buyer. |
| F36 | pgEdge Postgres MCP supports RLS through per-user roles or session variables in HTTP mode with tokens; tenant mapping left to the operator. | [Certain] (vendor docs) | pgmoat's token-claim mapping is the differentiator. |
| F37 | Postgres MCP servers have low download counts compared with popular MCP servers; local development is the strongest use case. | [Likely] (Bytebase) | Star goal halved; download goal anchored to the archived server's traffic. |
| F38 | YC Winter 2027 deadline is 2026-11-02; YC S26 is closed. | [Likely] (third-party deadline tracker) | YC goal removed from the PRD; pgmoat cannot ship before W27. |

### 2.6 Naming

| # | Finding | Confidence | Impact |
|---|---|---|---|
| F39 | Six GitHub repos named pgbridge, including AzeemQidwai/pgbridge (Python/Tkinter Postgres-to-SQL-Server migrator, MIT, public since 2026-09-17, installs a `pgbridge` command). No shared code or function with this product. | [Certain] (read the uploaded source) | No copyright issue. CLI collision and junior trademark position led to the rename. |
| F40 | `pgmoat`: free on npm and PyPI, zero GitHub repos, zero web results (2026-10-17). | [Certain] | New name. |
| F41 | Domain availability for pgmoat.dev could not be determined from here. | [Certain] that it is unknown | Open decision OD-01. |
| F42 | No registered trademark found for PGBRIDGE or PGMOAT in quick searches; this is not a legal clearance. | [Likely] | Open decision OD-02: attorney knockout search before filing. |

---

## 3) Decisions taken from these findings

| Decision | Driven by |
|---|---|
| Rename to pgmoat; error codes `PGM-xxx`; config `pgmoat.yaml`; repo `kitalonlabs/pgmoat` | F39, F40 |
| Target MCP SDK v2 and both protocol eras via `serveStdio(..., { legacy: 'serve' })` | F1, F9, F10 |
| Replace sessions with `instance_id`, `seq`, and per-request `client`, `principal`, `trace_id` | F1, F5 |
| Layered read-only: parser allow-list, function allow-list, single statement over extended protocol (cursor), `BEGIN READ ONLY`, role preflight | F15, F16, F22, F26, F27 |
| Query-time access policy for hidden tables, hidden columns, whole-row refs, `*`, catalogs | F17, F25 |
| Identity-bound RLS sources (`token`, `env`, `static`, trusted `meta`) | F5, F7, F23 |
| HTTP transport with OAuth resource-server validation in v1.0 (slip-tolerant) | F7, F8 |
| Untrusted-data framing plus `structuredContent` | F23 |
| `pgmoat doctor` with fail-closed startup | F23 |
| Tamper-evident hash-chained audit | Differentiation (F34, F35) and audit credibility |
| Budgets: 200 rows, 64 KB, plus lock timeout | F29 |
| Five tools (drop `count`, fold `list_views` into `list_tables`) | F2, smaller attack and context surface |
| Zero-config mode and drop-in compatibility with the archived reference server | F22, F37 |
| Node 22.12+ / TS 7 / libpg-query 18 / pgsql-deparser 18 / tsdown / Vitest 5 / pnpm 12 | F12, F13, F14, F18, F19 |
| Binaries deferred to v1.1 behind a spike | F20 |
| Postgres 15 to 18 support; 19 after GA | F21 |
| MCPB and MCP Registry as launch artifacts | F30, F31 |
| Six-week timeline starting 2026-10-26; launch 2026-12-08 | Scope growth and realism |
| Goals rewritten (download share, stars halved, no YC S26) | F37, F38 |

---

## 4) Per-document change log

### 01 PRD
- Renamed product; new tagline.
- Added "Why now," refreshed problem with the two real incidents.
- Rewrote goals (G1 to G5) and dropped the YC S26 goal.
- New competitive landscape and positioning (section 2).
- New guarantees and non-guarantees tables.
- New journeys: MCPB install, migration from the reference server, HTTP multi-tenant, security review.
- Requirements: R2, R5, R6, R7 rewritten; R3 (scoped write) moved to v1.1; R11, R12 promoted to Must; new R18 to R25 (query-time policy, HTTP auth, untrusted framing, doctor, annotations and structured output, zero-config, corpus, CLI).
- New dates, ship gate, business model, risk table with bypass classes, open decisions, name change record.

### 02 Feature Spec
- Every feature rewritten for SDK v2 and the stateless protocol.
- Tool set reduced to five; `outputSchema` and annotations specified per tool.
- New features: zero-config mode, query-time policy, HTTP and OAuth, doctor, hash chain and `audit verify`, `test-corpus`, MCPB packaging, MCP Registry publishing.
- Error codes renumbered to `PGM-xxx` with a cleaner 3xx budget range.

### 03 Technical Architecture
- Stack table replaced with October 2026 versions.
- Repo layout updated (no published `core` package; `cli` bundles core; `distribution/` folder for MCPB, Docker, registry).
- New request lifecycle with seven safety layers.
- Correct libpg-query AST shapes and SDK v2 code.
- HTTP transport and auth architecture.
- Threat model mapped to OWASP ASI IDs.

### 04 TRD
- Requirement IDs rebuilt from the new PRD; new families: `FR-POLICY`, `FR-AUTH`, `FR-DOCTOR`, `FR-CORPUS`, `FR-DIST`.
- NFR targets adjusted; Postgres and Node matrices updated.
- Ship gate aligned with PRD section 12.

### 05 Backend Schema
- `pgmoat.audit` DDL with `instance_id`, `seq`, `principal`, `transport`, `protocol_version`, `prev_hash`, `entry_hash`; `session_id` removed.
- Runtime types updated; Zod config schema rewritten for v2 config (transport, http, auth, policy, rls sources).
- Full `PGM-xxx` error taxonomy including 6xx auth and 7xx doctor codes.

### 06 UI/UX Design
- All CLI transcripts rewritten for pgmoat, zero-config, doctor, verify, test-corpus.
- Tool descriptions rewritten for five tools with untrusted-data framing.
- MCPB install flow and settings form.

### 07 Appflow
- Diagrams redrawn for stateless protocol, layered safety, identity-bound RLS, HTTP auth, hash-chained audit, MCPB and zero-config journeys.

### 08 Implementation Plan
- New 14-phase plan dated from 2026-10-26 to launch 2026-12-08, with phase gates.

### 09 Claude Code Prompt Pack (new)
- Atomic prompts for every phase with SKILL, DEPENDS, SOURCE, FILES, TASKS, VERIFY, PASS/FAIL, REPORT, COMMIT blocks, plus read-only audit prompts at each gate.

### CLAUDE.md (new)
- Repo-root rules for Claude Code: safety invariants, commands, conventions.

---

## 5) Sources

- MCP spec changelog 2026-07-28: https://modelcontextprotocol.io/specification/latest/changelog
- MCP basic protocol (statelessness, `_meta` rules): https://modelcontextprotocol.io/specification/2026-07-28/basic/index
- MCP authorization: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- MCP TypeScript SDK v2 docs: https://ts.sdk.modelcontextprotocol.io/v2/
- Claude blog, bringing MCP 2026-07-28 to Claude: https://claude.com/blog/bringing-mcp-2026-07-28-to-claude
- Datadog Security Labs, Postgres MCP SQL injection: https://securitylabs.datadoghq.com/articles/mcp-vulnerability-case-study-SQL-injection-in-the-postgresql-mcp-server/
- Simon Willison, Supabase MCP lethal trifecta: https://simonwillison.net/2025/Jul/06/supabase-mcp-lethal-trifecta/
- Bytebase, top open-source Postgres MCP servers (2026): https://www.bytebase.com/blog/top-open-source-postgres-mcp-servers/
- Bytebase/DBHub, state of Postgres MCP servers: https://glama.ai/mcp/servers/@bytebase/dbhub/blob/bdc906c1dffce4a916c264cc883c47e73a3557f1/docs/blog/state-of-postgres-mcp-servers-2025.mdx
- pgEdge MCP RLS docs: https://docs.pgedge.com/pgedge-postgres-mcp-server/v1-0-0/advanced/row-level-security/
- pgguard-mcp listing: https://glama.ai/mcp/servers/Azzaraell/pgguard-mcp
- OWASP Agentic Top 10 explainer: https://speakeasy.com/blog/owasp-agentic-top-10-explained
- Node.js releases: https://nodejs.org/en/about/previous-releases
- PostgreSQL roadmap: https://www.postgresql.org/developer/roadmap
- libpg-query: https://github.com/constructive-io/libpg-query-node
- tsdown executables: https://tsdown.dev/options/exe
- MCP Registry quickstart: https://modelcontextprotocol.io/registry/quickstart
- MCPB guide: https://claude.com/docs/connectors/building/mcpb
- Tool annotations overview: https://sunpeak.ai/blogs/testing-mcp-tool-annotations
- YC deadlines tracker: https://www.roundfunded.com/en/blogs/yc-application-deadlines-2026-2027
- AzeemQidwai/pgbridge (name collision): https://github.com/AzeemQidwai/pgbridge
