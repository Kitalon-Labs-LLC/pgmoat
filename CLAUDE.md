# CLAUDE.md: pgmoat

pgmoat is an MIT-licensed MCP server that gives AI agents governed, read-only access to Postgres: layered SQL safety, query-time access policy for hidden data, budgets, identity-bound row-level security, and a tamper-evident audit log. TypeScript on Node, MCP TypeScript SDK v2.

## Source of truth

- The spec lives in `spec/`. Read the sections a task cites before writing code.
- `spec/05-pgmoat-backend-schema.md` is canonical for names, types, defaults, config fields, and error codes. If code and spec disagree, stop and report; do not silently pick one.
- Build tasks come from `spec/09-pgmoat-claude-code-prompts.md`. Stay inside the files a prompt lists; explain any extra file in the REPORT.

## Safety invariants (never break these)

1. Agent SQL reaches Postgres only through `packages/core/src/safety/pipeline.ts` and then `packages/core/src/postgres/execute.ts`.
2. Agent SQL executes only through `pg-cursor` (extended protocol, one statement) inside `BEGIN READ ONLY`.
3. Never build SQL with string concatenation or template literals containing values. Build ASTs and deparse with `pgsql-deparser`, or use bound parameters. The `pgmoat/no-sql-string-building` lint rule enforces this; exceptions need a reason comment and are limited to static catalog queries and human-facing fix text.
4. Safety decisions work on libpg-query AST nodes, never on regex or substring matching of SQL text.
5. When unsure, refuse (fail closed). Unknown node types and unknown functions are refused.
6. Hidden tables and columns never appear in any tool output, error message, or log line visible to the agent. Hidden and unknown relations produce the identical message.
7. RLS values come only from trusted sources (`token.*` over HTTP with OAuth, `env.*`, `static:`, or `meta.*` on stdio with `trust_request_meta: true`). Values are always bound parameters to `set_config(name, value, true)`.
8. Nothing writes to stdout in stdio mode except the MCP transport. Logs go to stderr via pino.
9. Every tool call emits exactly one audit entry (in a `finally` block). Redact before hashing. Never log tokens.
10. Every change under `packages/core/src/safety/` adds or updates corpus cases in `packages/core/test/corpus/cases/`.

## Stack (October 2026)

Node `>=22.12.0` (develop on 24), pnpm 12, TypeScript 7 (`"types": ["node"]`), `@modelcontextprotocol/server` 2.3.x (+ `@modelcontextprotocol/node` for HTTP), `libpg-query` 18.x, `pgsql-deparser` 18.x, `pg` 8.23 + `pg-cursor` 2.22, Zod 4 (use `.prefault({})` for nested objects with defaults, not `.default({})`), `yaml` 2.x, `jose` 6.x, `pino` 10.x, `commander` 15.x, `@clack/prompts` 1.x, Vitest 5, Testcontainers 12, fast-check 4, tsdown 0.23.

Before using a third-party API, read its installed type definitions (`node_modules/<pkg>/dist/*.d.mts`). If they differ from the spec's code sketch, follow the types and report the difference.

## Commands

| Command | Purpose |
|---|---|
| `pnpm lint` | ESLint (includes the SQL string rule) |
| `pnpm typecheck` | TypeScript, no emit |
| `pnpm test` | Unit tests (no Docker) |
| `pnpm test:corpus` | Adversarial corpus, pipeline mode |
| `pnpm test:corpus:db` | Corpus against real Postgres (Docker) |
| `pnpm test:integration` | Integration tests (Docker); `PGMOAT_TEST_PG=15..18` selects the version |
| `pnpm coverage` | Coverage with thresholds (85% overall, 90% `safety/`) |
| `pnpm bench` | Benchmarks |
| `pnpm build` | Bundle the CLI |
| `pnpm check:errors` | Error registry matches spec/05 |
| `pnpm check:docs` | Generated docs are up to date |

## Layout

- `packages/core`: everything except the CLI (private, bundled). Safety in `src/safety`, Postgres in `src/postgres`, audit in `src/audit`, tools in `src/tools`, server and auth in `src/server`.
- `packages/cli`: the published `pgmoat` package.
- `packages/docs`: Astro Starlight site.
- `distribution/`: Docker, MCPB, MCP Registry metadata.
- `examples/`: runnable example projects.

## Conventions

- ESM, strict TypeScript, no `any` in `safety/`.
- Errors that reach users are `PgmoatError` with a registered `PGM-xxx` code. New codes update spec/05 section 4, regenerate `errors.generated.ts` (`pnpm gen:errors`), and add a docs note in the same change.
- Conventional Commits with scope, TRD IDs in the body. One prompt usually equals one PR.
- Gate prompts are read-only: report, do not edit.
- Audit before remediation: findings go to a register first, fixes come in separate changes with regression tests.

## Writing rules (code comments, docs, CLI text)

- Plain, specific, second person. Lead with the action or fact.
- No em dashes or en dashes. No curly quotes.
- Avoid: AI-powered, seamless, effortless, instantly, cutting-edge, unlock, transform, revolutionize, elevate, leverage (as a verb).
- CLI and error text must match `spec/06` transcripts; update the spec in the same change if you intentionally differ.
