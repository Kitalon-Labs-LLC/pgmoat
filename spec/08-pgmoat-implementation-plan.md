# Implementation Plan: pgmoat

Doc owner: Sowad Al-Mughni (Kitalon Labs)
Status: Draft v2 (supersedes pgbridge Implementation Plan v1)
Last updated: 2026-10-17
Companion docs: 01 to 07; 09 Claude Code Prompt Pack (the executable version of this plan)

This plan sequences pgmoat v1.0 into phases with dates, outcomes, and gates. The Prompt Pack (09) turns every phase into atomic Claude Code prompts. Read this for the shape; run 09 to build.

---

## 1) Assumptions

- One developer, full time, using Claude Code, starting Monday 2026-10-26.
- Sowad reviews every pull request touching `packages/core/src/safety/` and signs off each phase gate.
- Working days only; dates are targets, not promises. If a phase slips more than two days, re-plan at the next gate rather than compressing the safety phase.
- The spec set (00 to 09) is copied into the repo under `spec/` at P0 and is the source of truth. If code and spec disagree, stop and resolve the spec first (Backend Schema 05 wins on names, types, defaults, and codes).

---

## 2) Phases and milestones

| Phase | Dates (2026) | Outcome | Gate |
|---|---|---|---|
| P0 Bootstrap | Oct 26 to Oct 27 | Repo, workspace, CI, governance files, names claimed, specs in `spec/` | G-P0 |
| P1 Config, types, errors | Oct 27 to Oct 29 | Zod config, loader with line numbers, interpolation, error registry, runtime types | G-P1 |
| P2 Safety pipeline | Oct 28 to Nov 4 | Parse, walk, classify, functions, policy, rewrite, fingerprint, corpus runner with 200+ seed cases | G-P2 |
| P3 Postgres, RLS, doctor queries | Nov 2 to Nov 5 | Pools, execute path, introspection, RLS resolver, doctor checks, isolation tests | G-P3 |
| P4 Budgets and output | Nov 4 to Nov 6 | Column, cell, payload budgets; value conversion; framed text; output schemas | G-P4 |
| P5 Audit | Nov 5 to Nov 9 | Entry, redaction, chain, pipeline, file/stderr/postgres destinations, verify | G-P5 |
| P6 Schema and tools | Nov 6 to Nov 10 | Snapshot + annotations + cache; five tools; run-tool wrapper | G-P6 |
| P7 Stdio server and zero-config | Nov 10 to Nov 11 | `createServer`, `serveStdio` both eras, runtime lifecycle, zero-config | G-P7 |
| P8 CLI | Nov 11 to Nov 13 | init, start, validate, doctor, audit, schema-export, test-corpus, version | **M1 alpha, Fri Nov 13** |
| P9 HTTP and OAuth | Nov 16 to Nov 18 | Streamable HTTP, PRM, JWT validation, Host/Origin guards | G-P9 |
| P10 Distribution | Nov 18 to Nov 20 | tsdown bundle, npm with provenance, Docker, MCPB, registry, release workflow | G-P10 |
| P11 Docs site | Nov 19 to Nov 25 | Astro Starlight site, generated config and error pages, quickstart, migration, safety | G-P11 |
| P12 Hardening and beta | Nov 23 to Nov 27 | Corpus to 300+, property tests, benches, examples, security self-review, external testers | **M2 beta, Fri Nov 27** |
| P13 Launch | Nov 30 to Dec 8 | Fixes from beta, launch content, registry and directory submissions | **M3 v1.0, Tue Dec 8** |
| P14 v1.1 | Dec 9 to Jan 26, 2027 | Scoped writes with confirmation, more audit destinations, metrics, binaries | v1.1 gate |

Critical path: P1 to P2 to P6 to P7 to P8. P3, P4, P5 run in parallel with late P2 because they depend only on P1 types. P9 to P11 run in parallel after M1.

---

## 3) Phase details

### P0 Bootstrap
- pnpm 12 workspace (`packages/core`, `packages/cli`, `packages/docs`), TypeScript 7 base config, ESLint 10 flat config with the custom `no-sql-string-building` rule stub, Vitest 5 workspace, Changesets.
- Governance files, issue and PR templates, `CLAUDE.md`, `spec/` folder.
- CI: install (frozen lockfile), lint, typecheck, unit tests, on Node 22, 24, 26.
- Claim names: npm placeholder `pgmoat@0.0.0` (README only), GitHub repo, domain (OD-01).

### P1 Config, types, errors
- `errors.ts` generated from Backend Schema 05 section 4 (a script parses the tables and emits the registry; a CI check keeps them in sync).
- `types.ts` from Backend Schema 05 section 2.
- `config/schema.ts` with `.prefault()` on nested objects; cross-field checks; loader with `yaml` `LineCounter`; interpolation; zero-config defaults; watch.
- 40+ config fixtures.

### P2 Safety pipeline (longest; start early, review every PR)
- `parse.ts`, `walk.ts` with scopes, `statements.ts`, `functions.ts`, `classify.ts`, `policy.ts`, `rewrite.ts` with invariant re-check, `fingerprint.ts`, `pipeline.ts`.
- Corpus runner (pipeline mode) and the first 200 cases across all groups.
- Benchmark for parse + classify + policy.

### P3 Postgres, RLS, doctor queries
- Testcontainers helper for Postgres 15 to 18 with seed schema (users, orders, tickets, customers, api_keys, a 2M-row events table generated on demand, RLS policies, two roles).
- `pool.ts`, `execute.ts` (cursor, read-only transaction, local settings, cancellation, error mapping), `introspect.ts`, `rls/resolve.ts`, `doctor.ts`.
- Database-mode corpus runner: proves layer-4 blocking for refused writes.
- RLS isolation suite (1,000 alternating queries).

### P4 Budgets and output
- `budgets/columns.ts`, `cells.ts`, `payload.ts`; `output/values.ts`, `text.ts`, `schemas.ts`.

### P5 Audit
- `entry.ts`, `redact.ts`, `chain.ts` (+ verify), `pipeline.ts`, destinations, DDL, benchmarks.

### P6 Schema and tools
- `schema/snapshot.ts`, `cache.ts`; tool cores; `run-tool.ts` (request context, audit exactly once, error mapping); `register.ts`.

### P7 Stdio server and zero-config
- `server/create.ts`, `instructions.ts`, `stdio.ts`; `runtime.ts` (build deps, doctor on start, shutdown); stdout guard; protocol-compat tests with SDK v2 client in both eras.

### P8 CLI (M1)
- Commander entry with zero-config detection; commands; snapshot tests from UI/UX 06 transcripts; `--json`.
- M1: tag `v0.1.0-alpha.1`, try in Claude Desktop (manual JSON config), Claude Code, Cursor.

### P9 HTTP and OAuth
- `server/http.ts`, `server/auth.ts`, PRM endpoint, guards, body limit; tests with a local JWKS and minted tokens; MCP Inspector check.

### P10 Distribution
- tsdown bundle (externals: `libpg-query`, `pg`, `pg-cursor`), npm provenance publish workflow, Dockerfile, MCPB manifest and pack script, `server.json` and registry publish step.

### P11 Docs site
- Starlight scaffold; config reference generated from Zod; error pages generated from the registry; quickstart, migration, safety, RLS, HTTP, audit, prompt-injection pages; landing page.

### P12 Hardening and beta (M2)
- Corpus to 300+; property tests; benches to targets; five examples; security self-review against Tech Arch 03 section 13 (audit-first: findings register, then fixes); doctor on Supabase, Neon, RDS; three external quickstart testers; tag `v0.9.0`, publish beta to npm (`next` tag), MCPB on a pre-release.

### P13 Launch (M3)
- Fix beta issues; final corpus and coverage gates; `v1.0.0`; registry publish; Connectors Directory submission; launch posts; migration post.

### P14 v1.1
- Scoped writes with MRTR confirmation; Datadog, S3, OTLP; Prometheus; SEA binaries after the WASM spike; schema drift detection; audit chain heads table.

---

## 4) Gates

Each gate is a read-only audit prompt in 09 that produces a pass/fail report card. Fixes happen only after the report, in separate prompts, each with its own verification (audit before remediation).

| Gate | Must be true |
|---|---|
| G-P0 | Fresh clone: `pnpm install && pnpm lint && pnpm typecheck && pnpm test` passes on Node 22/24/26 in CI; governance files present; `spec/` present |
| G-P1 | Every Backend Schema field and default matches `schema.ts`; every code in section 4 exists in `errors.ts`; 40+ fixtures; minimal config yields the full default tree |
| G-P2 | 200+ corpus cases pass in pipeline mode; no SQL string building in `safety/`; parse+classify+policy p95 < 3 ms; coverage on `safety/` >= 90% |
| G-P3 | Read-only transaction and cursor used for every agent query; isolation suite zero leaks; database-mode corpus proves layer-4 blocking; doctor findings correct on fixtures |
| G-P4 | Budget unit tests; output schemas validate; fence escaping test |
| G-P5 | One entry per call; chain verify detects edit, delete, reorder; redaction tests; enqueue p95 < 1 ms; postgres destination idempotent DDL |
| G-P6 | Five tools return correct structured output; hidden data never appears in any output |
| G-P7 | Both protocol eras pass compat tests; no stray stdout; graceful shutdown; cancellation within 2 s |
| M1 | All above plus CLI commands and snapshot tests; works in Claude Desktop, Claude Code, Cursor |
| G-P9 | Auth tests (audience, expiry, scope, unknown key, Origin, body limit); PRM correct; RLS from token claims |
| G-P10 | Dry-run release builds npm tarball, Docker image, MCPB, server.json; tarball installs and runs via npx in a clean container |
| G-P11 | Every config field and error code has docs; Lighthouse >= 95 |
| M2 | TRD P0 complete; corpus 300+ at 100% on PG 15 to 18; coverage gates; perf targets; three external testers |
| M3 | TRD ship gate (04 section 9) |

---

## 5) Risks to the schedule

| Risk | Mitigation |
|---|---|
| Policy layer (scopes, aliases, CTE shadowing) takes longer than planned | Start P2 on day 3; implement conservative rules first (they can only over-refuse), tighten later |
| SDK v2 API details differ from the spec's code shapes | Every prompt instructs reading installed `.d.mts` types first |
| libpg-query WASM loading quirks in bundling | Keep it external in tsdown; test the packed tarball in P10 |
| OAuth testing friction | Local JWKS with `jose`-minted tokens in tests; real IdP checks only in P12 |
| Scope creep (writes, more destinations) | Locked to v1.1; PRs adding them before M3 are declined |

---

## 6) Definition of done (any prompt)

1. All VERIFY commands pass.
2. No new lint warnings; typecheck clean.
3. Tests added for new behavior; corpus cases added for any safety change.
4. Docs or spec updated if behavior or names changed.
5. Conventional commit with TRD IDs in the body.
