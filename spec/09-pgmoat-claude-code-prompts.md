# Claude Code Prompt Pack: pgmoat v1.0

Doc owner: Sowad Al-Mughni (Kitalon Labs)
Prepared by: principal architect review, 2026-10-17
Status: Ready for build
Companion docs: `spec/00` to `spec/08`, repo-root `CLAUDE.md`

This pack is the executable form of the Implementation Plan (08). Each prompt is one atomic unit of work with a single contract, explicit files, and a verification block. Run them in order. Do not skip gates.

---

## How to use this pack

1. Complete P0.1 to create the repository, then copy the whole spec set into `spec/` and `CLAUDE.md` into the repo root (P0.3 does this).
2. Open Claude Code in the repo root. It reads `CLAUDE.md` automatically.
3. For each prompt: paste the entire block (from `### Pn.m` to the end of its COMMIT line) into Claude Code. Let it finish. Read its REPORT.
4. If VERIFY passes, let it commit (or commit yourself). If it fails, paste the failing output back and ask it to fix within the same prompt's scope. Do not move on with a red VERIFY.
5. At each **GATE** prompt, Claude Code only reads and reports. It must not edit files. Fix findings with follow-up prompts that cite the finding ID, then re-run the gate.
6. Start a fresh Claude Code session (or `/clear`) at each phase boundary to keep context focused. The spec and `CLAUDE.md` carry the shared knowledge.
7. When a prompt says "read the installed types," Claude Code must open `node_modules/<package>/dist/*.d.mts` (or `.d.ts`) and follow the real API if it differs from the spec's code sketch. It reports any difference.

### Prompt fields

| Field | Meaning |
|---|---|
| SKILL | Expertise the prompt needs. If you have a Claude Code skill with this name installed, Claude Code may use it; otherwise it is a hint about mindset. |
| DEPENDS | Prompts that must be complete first |
| SOURCE | Spec sections that define the behavior. Claude Code reads them before coding. |
| FILES | Files to create or modify. Anything else needs a reason in the REPORT. |
| GOAL | One-sentence contract |
| CONTEXT | Constraints and facts that are easy to get wrong |
| TASKS | Numbered steps |
| VERIFY | Commands that must pass |
| PASS/FAIL | What counts as done |
| REPORT | What Claude Code prints at the end |
| COMMIT | Conventional commit message with TRD IDs |

### Standard commands (defined in P0.1)

| Command | Runs |
|---|---|
| `pnpm lint` | ESLint over the repo |
| `pnpm typecheck` | `tsc -b` in all packages (no emit) |
| `pnpm test` | Unit tests (fast, no Docker) |
| `pnpm test:corpus` | Corpus, pipeline mode (no Docker) |
| `pnpm test:corpus:db` | Corpus, database mode (Docker) |
| `pnpm test:integration` | Integration tests (Docker) |
| `pnpm bench` | Benchmarks |
| `pnpm build` | Bundle the CLI |
| `pnpm check:errors` | Error registry matches `spec/05` section 4 |
| `pnpm coverage` | Unit + corpus with coverage thresholds |

### Prompt index

| Phase | Prompts |
|---|---|
| P0 Bootstrap | P0.1 to P0.5, GATE-P0 |
| P1 Config, types, errors | P1.1 to P1.8, GATE-P1 |
| P2 Safety pipeline | P2.1 to P2.13, GATE-P2 |
| P3 Postgres, RLS, doctor | P3.1 to P3.8, GATE-P3 |
| P4 Budgets and output | P4.1 to P4.3, GATE-P4 |
| P5 Audit | P5.1 to P5.7, GATE-P5 |
| P6 Schema and tools | P6.1 to P6.8, GATE-P6 |
| P7 Stdio server | P7.1 to P7.4, GATE-P7 |
| P8 CLI | P8.1 to P8.7, GATE-M1 |
| P9 HTTP and OAuth | P9.1 to P9.4, GATE-P9 |
| P10 Distribution | P10.1 to P10.4, GATE-P10 |
| P11 Docs site | P11.1 to P11.3, GATE-P11 |
| P12 Hardening and beta | P12.1 to P12.6, GATE-M2 |
| P13 Launch | P13.1 to P13.2, GATE-M3 |
| P14 v1.1 | P14.1 to P14.6 (outlines) |

---

# Phase P0: Bootstrap (Oct 26 to Oct 27)

### P0.1 Initialize the pnpm workspace

SKILL: ts-monorepo
DEPENDS: none
SOURCE: spec/03 sections 1 and 2; spec/08 section 3 (P0)
FILES:
- package.json, pnpm-workspace.yaml, tsconfig.base.json, .editorconfig, .gitignore, .nvmrc, .npmrc
- packages/core/package.json, packages/core/tsconfig.json, packages/core/src/index.ts, packages/core/src/version.ts
- packages/cli/package.json, packages/cli/tsconfig.json, packages/cli/src/bin.ts
- packages/docs/package.json (placeholder, private)
- vitest.workspace.ts, packages/core/vitest.config.ts, packages/cli/vitest.config.ts
- packages/core/test/unit/smoke.test.ts

GOAL: A fresh clone runs `pnpm install && pnpm typecheck && pnpm test` successfully.

CONTEXT:
- pnpm 12.x, Node `>=22.12.0` (`.nvmrc` = 24), TypeScript 7.0.x, Vitest 5.0.x. Check the latest patch versions with `npm view <pkg> version` before pinning.
- ESM everywhere (`"type": "module"`). `tsconfig.base.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `target: "ES2023"`, `types: ["node"]` (required by MCP SDK v2 on TS 6+), `verbatimModuleSyntax: true`, `skipLibCheck: true`.
- `packages/core` is private: name `@pgmoat/core`. `packages/cli` will publish as `pgmoat` (keep `"private": true` until P10).
- `version.ts` exports `PGMOAT_VERSION` read at build time (for now a constant `'0.0.0'`).

TASKS:
1. Create the root `package.json` with `"packageManager": "pnpm@12.x"`, engines, and the standard scripts from the pack header (use placeholders that exit 0 for commands whose tooling arrives later, and say so in the REPORT).
2. Create the workspace packages and tsconfigs with project references (`cli` references `core`).
3. Configure Vitest workspace with separate projects: `unit` (core/test/unit, cli/test), `corpus` (core/test/corpus), `integration` (core/test/integration, longer timeouts), and include `@vitest/coverage-v8`.
4. Add a smoke test that imports `PGMOAT_VERSION` and asserts it is a string.
5. Add `.gitignore` entries: `node_modules`, `dist`, `coverage`, `*.log`, `pgmoat-audit/`, `.env*`.

VERIFY:
```bash
corepack enable && pnpm install
pnpm typecheck
pnpm test
node -e "const p=require('./package.json');if(!p.engines||!p.engines.node.includes('22.12'))process.exit(1)"
```

PASS/FAIL: All commands exit 0. `pnpm test` runs one passing test.

REPORT: Installed versions of pnpm, TypeScript, Vitest; list of scripts and which are placeholders.

COMMIT: `chore: initialize pnpm workspace with core and cli packages`

---

### P0.2 Lint, format, and the SQL string rule

SKILL: ts-monorepo
DEPENDS: P0.1
SOURCE: spec/03 section 14; spec/04 SEC-INJECT-03
FILES:
- eslint.config.js, .prettierrc.json, .prettierignore
- tools/eslint-rules/no-sql-string-building.js
- tools/eslint-rules/no-sql-string-building.test.js
- package.json (scripts: lint, format)

GOAL: `pnpm lint` enforces strict TypeScript rules, security rules, and forbids building SQL with string concatenation or template literals.

CONTEXT:
- ESLint 10 flat config, `typescript-eslint` 8.x (`strictTypeChecked`), `eslint-plugin-security` 4.x. Prettier current major for formatting.
- The custom rule flags (a) template literals with at least one expression whose quasis contain an SQL keyword token (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `FROM`, `WHERE`, `SET`, `JOIN`, `LIMIT`, `VALUES`, `INTO`, `TABLE`, case-insensitive, word-bounded), and (b) `+` expressions where any string literal operand contains such a keyword and any operand is not a literal.
- Allowed: template literals with no expressions; test files under `**/test/**`; lines with `// eslint-disable-next-line pgmoat/no-sql-string-building -- <reason>` (require a reason via `eslint-comments/require-description` or equivalent).
- No `any` in `packages/core/src/safety/**` (rule `@typescript-eslint/no-explicit-any: error` there).

TASKS:
1. Write the rule with clear messages: "Build SQL as an AST and deparse it, or use bound parameters."
2. Write RuleTester tests: at least 8 invalid and 8 valid cases.
3. Wire the rule into `eslint.config.js` as plugin `pgmoat`.
4. Add `pnpm lint` and `pnpm format` scripts.

VERIFY:
```bash
pnpm lint
node --test tools/eslint-rules/no-sql-string-building.test.js
```

PASS/FAIL: Lint passes on the repo; rule tests pass.

REPORT: Rule test counts; any rules disabled and why.

COMMIT: `chore: add eslint flat config and no-sql-string-building rule (SEC-INJECT-03)`

---

### P0.3 Governance files, CLAUDE.md, and spec folder

SKILL: oss-maintainer
DEPENDS: P0.1
SOURCE: spec/02 F21; spec/01 sections 4.2 and 16
FILES:
- LICENSE (MIT, "Copyright (c) 2026 Kitalon Labs")
- README.md (skeleton), SECURITY.md, CONTRIBUTING.md, GOVERNANCE.md, CODE_OF_CONDUCT.md, CHANGELOG.md
- .github/ISSUE_TEMPLATE/bug.yml, feature.yml, config.yml (security issues redirect to SECURITY.md)
- .github/PULL_REQUEST_TEMPLATE.md
- CLAUDE.md (copy from the handoff bundle, unchanged)
- spec/00 to spec/09 (copy from the handoff bundle, unchanged)
- .changeset/config.json

GOAL: The repo has every governance file, the spec set, and the Claude Code rules file.

CONTEXT:
- README skeleton sections in this order: title and tagline ("Governed Postgres access for AI agents."), install one-liner, "What pgmoat will not do" (from spec/01 section 4.2), quickstart placeholder, safety model link, license.
- SECURITY.md: report to security@kitalonlabs.com, 72-hour acknowledgment, 90-day disclosure, GitHub Security Advisories, PGP key placeholder `TODO(Sowad): add key`.
- CONTRIBUTING.md: DCO sign-off (`git commit -s`), Changesets for user-facing changes, "every change under packages/core/src/safety needs corpus cases," TRD IDs in PR descriptions, how to run tests (Docker needed for integration).
- PR template checklist: tests added, corpus cases for safety changes, docs updated, TRD IDs, no SQL string building.
- Changesets config for a single published package (`pgmoat`), ignore private packages.

TASKS:
1. Create all files.
2. Copy the spec set and CLAUDE.md byte-for-byte.
3. Add a `spec/README.md` that lists the docs and says "Backend Schema (05) is canonical for names, types, defaults, and error codes."

VERIFY:
```bash
test -f LICENSE && test -f SECURITY.md && test -f CLAUDE.md && test -f spec/05-pgmoat-backend-schema.md
grep -q "security@kitalonlabs.com" SECURITY.md
grep -q "What pgmoat will not do" README.md
pnpm lint
```

PASS/FAIL: All checks pass.

REPORT: List of files created; any placeholders left for Sowad.

COMMIT: `docs: add governance files, CLAUDE.md, and spec set`

---

### P0.4 CI workflows

SKILL: release-engineering
DEPENDS: P0.2
SOURCE: spec/03 sections 15 and 17.5; spec/04 SEC-SUPPLY-01..04
FILES:
- .github/workflows/ci.yml
- .github/workflows/codeql.yml
- .github/workflows/dependency-review.yml
- tools/check-licenses.mjs
- package.json (script: check:licenses)

GOAL: Every push and PR runs install, lint, typecheck, unit tests on Node 22, 24, 26, plus CodeQL, dependency review, and a license check.

CONTEXT:
- `pnpm install --frozen-lockfile`. Cache the pnpm store.
- Matrix: node `[22, 24, 26]`, ubuntu-latest. Also run unit tests once on `macos-latest` and `windows-latest` with Node 24.
- A second job `integration` (ubuntu, Node 24) runs `pnpm test:integration` and `pnpm test:corpus:db`; it is allowed to be a placeholder until P3 (echo and exit 0) but must exist.
- License check: allow MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD, BlueOak-1.0.0, CC0-1.0, Python-2.0 (for transitive tooling), MPL-2.0 only for dev dependencies; fail otherwise. Use `pnpm licenses list --json --prod`.
- Pin third-party actions by full commit SHA.

TASKS:
1. Write the three workflows.
2. Write the license checker script.
3. Ensure secrets are not required for PRs from forks.

VERIFY:
```bash
pnpm check:licenses
npx --yes @action-validator/cli .github/workflows/ci.yml || echo "validator unavailable; review YAML manually"
pnpm lint && pnpm typecheck && pnpm test
```

PASS/FAIL: License check passes locally; workflows are valid YAML with SHA-pinned actions.

REPORT: Workflow job list; any action you could not SHA-pin.

COMMIT: `ci: add CI matrix, CodeQL, dependency review, license check (SEC-SUPPLY-01..03)`

---

### P0.5 Name claims and placeholder publish (manual with Claude Code assist)

SKILL: release-engineering
DEPENDS: P0.3
SOURCE: spec/01 sections 15 (OD-01, OD-02) and 16
FILES:
- docs/maintainers/name-claims.md

GOAL: The npm name, GitHub repo, and domain are claimed, and the steps are recorded.

CONTEXT:
- Public first use gives naming priority. Claim on day one.
- Placeholder npm package: a temporary folder with only `package.json` (`name: pgmoat`, `version: 0.0.0`, `description: "Governed Postgres access for AI agents. Coming soon."`, `license: MIT`, repository URL) and a README. Do not publish the real code.
- Claude Code cannot log in to npm or a registrar for you; it prepares files and commands, and the maintainer runs them.

TASKS:
1. Create `docs/maintainers/name-claims.md` with a checklist: npm placeholder publish commands, GitHub repo creation and settings (branch protection on main, required checks, secret scanning, Dependabot), domain registration for pgmoat.dev (or the fallback chosen in OD-01), and a reminder to commission a trademark knockout search before any filing (OD-02).
2. Generate the placeholder package in `tmp/npm-placeholder/` (gitignored) with the exact commands to publish it.

VERIFY:
```bash
test -f docs/maintainers/name-claims.md
test -f tmp/npm-placeholder/package.json && node -e "const p=require('./tmp/npm-placeholder/package.json');if(p.name!=='pgmoat'||p.version!=='0.0.0')process.exit(1)"
```

PASS/FAIL: Files exist; maintainer has run the publish (record the date in the checklist).

REPORT: Commands for the maintainer to run.

COMMIT: `docs: add name claim checklist`

---

### GATE-P0 Bootstrap audit (read-only)

SKILL: security-audit
DEPENDS: P0.1 to P0.5
SOURCE: spec/08 section 4 (G-P0)

Do not modify any file. Run each check and print a report card:

| # | Check | How |
|---|---|---|
| 1 | Fresh install works | `pnpm install --frozen-lockfile` |
| 2 | Lint clean | `pnpm lint` |
| 3 | Typecheck clean | `pnpm typecheck` |
| 4 | Unit tests pass | `pnpm test` |
| 5 | License check passes | `pnpm check:licenses` |
| 6 | Governance files present and non-empty | list files and sizes |
| 7 | `spec/` contains 00 to 09 and README | `ls spec` |
| 8 | `CLAUDE.md` matches the bundle copy | checksum comparison if bundle path is available, else note |
| 9 | Actions pinned by SHA | grep workflows for `uses:` without a 40-char SHA |
| 10 | No secrets committed | `git log -p | grep -iE "(password|secret|token)=" | head` and review |

Output: PASS or FAIL per row, with file and line for each FAIL. End with "GATE-P0: PASS" or "GATE-P0: FAIL (n findings)" and a numbered findings list (F-P0-01, ...).

---

# Phase P1: Config, types, errors (Oct 27 to Oct 29)

### P1.1 Error registry generated from the spec

SKILL: ts-monorepo
DEPENDS: P0.1
SOURCE: spec/05 section 4 and section 2.1
FILES:
- tools/gen-errors.mjs
- packages/core/src/errors.generated.ts (generated, committed)
- packages/core/src/errors.ts
- packages/core/test/unit/errors.test.ts
- package.json (scripts: gen:errors, check:errors)

GOAL: Every `PGM-xxx` code in spec/05 section 4 exists in code with title and kind, and CI fails if they drift.

CONTEXT:
- Parse the markdown tables under "## 4) Error code registry" in `spec/05-pgmoat-backend-schema.md`. Each row's first cell is the code. Capture: code, a short title (from the "Cause" or "Finding" column, trimmed to 80 characters), section (0xx to 7xx), kind (from a "Kind" column where present; otherwise infer: 1xx `startup`, 21x `refused`, 5xx `error`, 6xx `auth`, 7xx `doctor`), and HTTP status for 6xx.
- Output a frozen object `ERROR_CODES` and the `ErrorCode` union type.
- `errors.ts` exports `PgmoatError` (spec/05 section 2.1), `refuse(code, message, hint?)`, `fail(code, message)`, `isPgmoatError`, and `docsUrl(code)` returning `https://pgmoat.dev/docs/errors/<code>`.
- `check:errors` regenerates to a temp file and diffs against the committed file.

TASKS:
1. Write the generator (no dependencies beyond Node).
2. Generate and commit `errors.generated.ts`.
3. Write `errors.ts`.
4. Tests: registry contains PGM-001, PGM-111, PGM-204, PGM-208, PGM-303, PGM-405, PGM-601, PGM-705; `PgmoatError` carries code, kind, hint, docsUrl; every code matches `/^PGM-\d{3}$/`.

VERIFY:
```bash
pnpm gen:errors && pnpm check:errors
pnpm --filter @pgmoat/core exec vitest run test/unit/errors.test.ts
pnpm typecheck && pnpm lint
```

PASS/FAIL: All pass; the registry count equals the number of code rows in spec/05 section 4.

REPORT: Count of codes per section.

COMMIT: `feat(core): error registry generated from spec (FR-CLI-05, QA-04)`

---

### P1.2 Runtime types

SKILL: ts-monorepo
DEPENDS: P1.1
SOURCE: spec/05 section 2
FILES:
- packages/core/src/types.ts
- packages/core/test/unit/types.test-d.ts (type tests with `expectTypeOf`)

GOAL: `types.ts` declares every runtime type in spec/05 section 2 with identical names and fields.

CONTEXT:
- Copy field names exactly (camelCase in runtime types; snake_case in `AuditEntry` and `RowsResult` because they are wire formats).
- Use `readonly` where spec/05 shows `Readonly`/`ReadonlyMap`/`ReadonlySet`.
- `ErrorCode` comes from `errors.generated.ts`.

TASKS:
1. Write `types.ts`.
2. Add type tests for a few critical shapes (`SafetyResult` discriminated union narrows on `allowed`; `AuditEntry.status` union).

VERIFY:
```bash
pnpm typecheck
pnpm --filter @pgmoat/core exec vitest run --typecheck test/unit/types.test-d.ts
```

PASS/FAIL: Typecheck passes; type tests pass.

REPORT: Any spec ambiguity found and how you resolved it (and propose a spec fix).

COMMIT: `feat(core): runtime types from backend schema`

---

### P1.3 Config schema and zero-config defaults

SKILL: config-validation
DEPENDS: P1.2
SOURCE: spec/05 sections 3.1 and 3.3
FILES:
- packages/core/src/config/schema.ts
- packages/core/src/config/defaults.ts
- packages/core/test/unit/config/schema.test.ts

GOAL: `PgmoatConfig` validates `pgmoat.yaml` exactly as specified, and a minimal config parses to the full default tree.

CONTEXT:
- Zod 4.x (`import * as z from 'zod'`). Read the installed Zod types if unsure of an API.
- Use `.prefault({})` for nested objects with inner defaults. `.default({})` in Zod 4 returns `{}` without inner defaults (verified). Records use `.default({})`.
- `AuditConfig` is a discriminated union on `destination`; the top-level field uses `.prefault({ destination: 'file' })`.
- `defaults.ts` exports `buildZeroConfig(url: string): PgmoatConfigT` producing spec/05 section 3.3, with `doctor.on_start: 'warn'`.
- Export `PgmoatConfigT` (output type) and `PgmoatConfigInput` (input type).

TASKS:
1. Implement the schema exactly as spec/05 section 3.1.
2. Implement `buildZeroConfig`.
3. Tests: minimal config yields every default (assert a deep snapshot); each enum rejects invalid values; `server.name` regex; RLS source regex accepts the four forms and rejects others; Postgres setting regex requires a dot; unknown keys rejected (`strict`).

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/config/schema.test.ts
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass; the default-tree snapshot matches spec/05 defaults (budgets 200/5000/500/1000/50/65536/500, pool 1/10/3000, audit file with default redact lists).

REPORT: The default tree as JSON.

COMMIT: `feat(config): zod schema and zero-config defaults (IR-CONFIG-01, SEC-DEFAULT-01..05)`

---

### P1.4 Cross-field checks

SKILL: config-validation
DEPENDS: P1.3
SOURCE: spec/05 section 3.2
FILES:
- packages/core/src/config/checks.ts
- packages/core/test/unit/config/checks.test.ts

GOAL: Insecure or inconsistent combinations are refused with the right code before startup.

CONTEXT:
- Implement the static rules (those not needing introspection): PGM-102 (v1.0: any `mode: scoped-write` is refused with "Scoped writes arrive in v1.1"), PGM-103, PGM-105, PGM-106, PGM-111, PGM-112, PGM-113, PGM-114, PGM-116, PGM-117 (warning unless strict).
- Loopback detection: `127.0.0.1`, `::1`, `localhost`.
- Post-introspection rules (PGM-115, PGM-118, stale columns) are exported as `checkAgainstSchema(config, snapshot)` but implemented in P6.1; stub with a TODO that fails tests if called.
- Return `{ errors: PgmoatError[], warnings: PgmoatError[] }`; do not throw.

TASKS:
1. Implement `checkConfig(config, { strict })`.
2. One test per rule with a minimal failing config and one passing config.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/config/checks.test.ts
pnpm typecheck && pnpm lint
```

PASS/FAIL: Every rule has a failing and passing test.

REPORT: Table of rule to test name.

COMMIT: `feat(config): cross-field safety checks (FR-RLS-02, FR-AUTH-02, SEC-DEFAULT-*)`

---

### P1.5 Interpolation

SKILL: config-validation
DEPENDS: P1.3
SOURCE: spec/05 section 3.4; spec/03 section 12
FILES:
- packages/core/src/config/interpolate.ts
- packages/core/test/unit/config/interpolate.test.ts

GOAL: `${VAR}`, `${VAR:-default}`, and `${file:/abs/path}` work in string values only, with precise errors.

CONTEXT:
- Operates on the parsed YAML document (not raw text) so keys are never interpolated and line numbers stay available.
- Missing variable: `PGM-108` with the YAML path (for example `connection.url`) and variable name.
- `${file:...}` requires an absolute path; trims one trailing newline; missing file is `PGM-108` with the path.
- No recursive interpolation. `$${VAR}` escapes to a literal `${VAR}`.
- Environment is injected (a `Record<string, string | undefined>`), not read from `process.env` inside the function, for testability.

TASKS:
1. Implement `interpolate(doc, env, readFile)`.
2. Tests: each form; escapes; missing var path in error; keys untouched; numbers untouched.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/config/interpolate.test.ts
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass.

REPORT: Test count.

COMMIT: `feat(config): environment and file interpolation`

---

### P1.6 Config loader with line-numbered errors

SKILL: config-validation
DEPENDS: P1.4, P1.5
SOURCE: spec/03 section 12; spec/02 F3
FILES:
- packages/core/src/config/load.ts
- packages/core/test/unit/config/load.test.ts

GOAL: `loadConfig()` finds, parses, interpolates, validates, checks, and freezes the config, with errors that point to the line and column.

CONTEXT:
- Search order: explicit path, `$PGMOAT_CONFIG`, `./pgmoat.yaml`, `~/.config/pgmoat/config.yaml` (respect `XDG_CONFIG_HOME`), `/etc/pgmoat/config.yaml`. Return `{ kind: 'file', path, config, warnings }` or `{ kind: 'none' }`.
- Parse with `yaml` 2.x `parseDocument` and a `LineCounter`. YAML errors: `PGM-107` with line and column.
- Zod issues: `PGM-109`, map `issue.path` to the YAML node range to get line and column; message format: `pgmoat.yaml:44:7 budgets.max_rows: Number must be greater than or equal to 1`.
- After `checkConfig`, throw a single aggregated `PgmoatError` listing all errors (exit code 3 at CLI level); return warnings.
- `Object.freeze` deeply.

TASKS:
1. Implement `findConfig`, `loadConfig({ path?, env, cwd, strict })`.
2. Tests with temp dirs: search order precedence; syntax error line/col; schema error line/col; env missing; multiple errors aggregated; warnings returned.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/config/load.test.ts
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass; error messages include `file:line:col`.

REPORT: Example error output for a schema violation.

COMMIT: `feat(config): loader with search order and line-numbered errors (IR-CONFIG-01)`

---

### P1.7 Config fixtures

SKILL: config-validation
DEPENDS: P1.6
SOURCE: spec/05 section 3; spec/01 section 8
FILES:
- packages/core/test/fixtures/configs/*.yaml (at least 40)
- packages/core/test/unit/config/fixtures.test.ts

GOAL: A fixture library covers every valid shape and every refusal rule, reused by later tests.

CONTEXT:
- Name fixtures by intent: `valid-minimal.yaml`, `valid-full-http.yaml` (the PRD section 8 example), `valid-stdio-meta-rls.yaml`, `hidden-password.yaml` (users.password_hash hidden; used by corpus), `hidden-tables.yaml`, `catalog-allowed.yaml`, `invalid-stdout-stdio.yaml` (PGM-111), `invalid-meta-http.yaml` (PGM-112), `invalid-token-stdio.yaml` (PGM-113), `invalid-public-bind-noauth.yaml` (PGM-114), and so on.
- The test iterates all fixtures; each fixture starts with a comment `# expect: valid` or `# expect: PGM-xxx[,PGM-yyy]`.

TASKS:
1. Write the fixtures.
2. Write the table-driven test.

VERIFY:
```bash
ls packages/core/test/fixtures/configs/*.yaml | wc -l
pnpm --filter @pgmoat/core exec vitest run test/unit/config/fixtures.test.ts
```

PASS/FAIL: 40 or more fixtures; all expectations met.

REPORT: Fixture count by expectation.

COMMIT: `test(config): fixture library covering all rules`

---

### P1.8 Config watcher

SKILL: config-validation
DEPENDS: P1.6
SOURCE: spec/03 section 7; spec/02 F3
FILES:
- packages/core/src/config/watch.ts
- packages/core/test/unit/config/watch.test.ts

GOAL: `watchConfig()` emits validated reloads within 5 s and keeps the last good config on invalid edits.

CONTEXT:
- Use `node:fs` `watch` with a 200 ms debounce; fall back to polling (`fs.watchFile`, 1 s) when `watch` throws (network filesystems).
- Reloadable sections: `tables`, `budgets`, `policy`, `schema`, `rls.protected_tables`, `logging`. Changes to `connection`, `transport`, `http`, `auth`, `audit`, `rls.session_variables` produce a warning "restart required" and are not applied.
- API: `watchConfig(path, current, onChange, onError): () => void` (returns unsubscribe).

TASKS:
1. Implement.
2. Tests with temp files and fake timers where possible: valid change applied; invalid change reported and old config kept; restart-required warning.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/config/watch.test.ts
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass in under 10 s.

REPORT: Debounce and fallback behavior.

COMMIT: `feat(config): watch mode with safe reload (FR-SCHEMA-07)`

---

### GATE-P1 Config audit (read-only)

SKILL: security-audit
DEPENDS: P1.1 to P1.8
SOURCE: spec/05 sections 2 to 4; spec/08 G-P1

Do not modify files. Report card:

| # | Check |
|---|---|
| 1 | Every field, type, and default in spec/05 section 3.1 matches `schema.ts` (list mismatches field by field) |
| 2 | No nested object uses `.default({})` where inner defaults exist (`grep -n "default({})" packages/core/src/config/schema.ts` and inspect each) |
| 3 | `pnpm check:errors` passes; registry count matches spec |
| 4 | Every rule in spec/05 section 3.2 (static ones) has a test |
| 5 | 40+ fixtures and all pass |
| 6 | `pnpm test`, `pnpm typecheck`, `pnpm lint` pass |
| 7 | Coverage of `packages/core/src/config` >= 90% (`pnpm coverage` filtered) |

End with "GATE-P1: PASS" or "GATE-P1: FAIL" and findings F-P1-nn.

---

# Phase P2: Safety pipeline (Oct 28 to Nov 4)

Every PR in this phase is reviewed by Sowad before merge. Conservative is correct: when unsure, refuse.

### P2.1 Parser wrapper

SKILL: postgres-sql-safety
DEPENDS: P1.1
SOURCE: spec/03 section 5.1; spec/02 F5
FILES:
- packages/core/src/safety/parse.ts
- packages/core/test/unit/safety/parse.test.ts

GOAL: `parseSql()` returns the libpg-query AST or refuses with PGM-206, never anything else.

CONTEXT:
- `libpg-query` 18.1.x. Use the async `parse` (auto-loads WASM). Read its type definitions; the root is `{ version: number, stmts: Array<{ stmt: Node, stmt_location?: number, stmt_len?: number }> }`. There is no `RawStmt` wrapper in this version.
- Add `@pgsql/types` 18.x for node types.
- Refuse: input longer than `maxSqlChars`; parse error (sanitize the message: keep the parser's message and cursor position, drop internals); zero statements (empty or comment-only).
- Return type: `{ tree: ParseResult; grammarVersion: number }`.
- Warm the WASM module at startup via an exported `warmParser()`.

TASKS:
1. Implement `parseSql(sql, { maxSqlChars })` and `warmParser()`.
2. Tests: simple select; two statements produce two entries (do not refuse here; classification does); syntax error yields PGM-206 with position; empty and comment-only yield PGM-206; over-length yields PGM-206 without calling the parser (spy).

VERIFY:
```bash
pnpm --filter @pgmoat/core add libpg-query@^18.1.5 @pgsql/types@^18
pnpm --filter @pgmoat/core exec vitest run test/unit/safety/parse.test.ts
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass.

REPORT: Installed parser version and `version` field value (expect 180004 or later).

COMMIT: `feat(safety): libpg-query parser wrapper, fail closed (FR-READ-01)`

---

### P2.2 AST walker with scopes

SKILL: postgres-sql-safety
DEPENDS: P2.1
SOURCE: spec/03 section 5.2
FILES:
- packages/core/src/safety/walk.ts
- packages/core/test/unit/safety/walk.test.ts

GOAL: A generic walker visits every node and provides correct scope information (CTE names and FROM relations with aliases) to visitors.

CONTEXT:
- Node encoding: a wrapped node is an object with exactly one key whose name starts with an uppercase letter (for example `{ SelectStmt: {...} }`, `{ ColumnRef: {...} }`). Lists are arrays of wrapped nodes. Some fields hold unwrapped structs (for example `alias: { aliasname }`).
- Visitor signature: `(node: unknown, type: string, path: readonly (string|number)[], scope: Scope) => void`.
- `Scope`: `{ parent?: Scope; ctes: Set<string>; relations: Array<{ alias: string | null; schema: string | null; name: string; isCte: boolean }>; kind: 'select' | 'root' }`.
- Entering a `SelectStmt`: create a child scope; first register `withClause.ctes[].CommonTableExpr.ctename` (recursive CTEs see themselves), then walk `fromClause` to register `RangeVar` (with `alias.aliasname`), `RangeSubselect` aliases, `RangeFunction` aliases, and `JoinExpr` children; then walk the rest (target list, where, group, having, order, limit, window) with that scope.
- `LATERAL` subqueries see the relations registered earlier in the same FROM list.
- Set operations (`op != SETOP_NONE`, with `larg`/`rarg`): each arm gets its own scope; the outer statement's `withClause` CTEs are visible to both.
- The walker must not recurse infinitely on malformed input; cap depth at 1,000 and throw PGM-206 beyond it.

TASKS:
1. Implement `walk(tree, visitor)` and helpers `getNodeType`, `unwrap`.
2. Tests: counts every `ColumnRef` in a complex query; scope of a column in a subquery includes outer relations; CTE names visible; CTE shadows a table name; LATERAL sees earlier relations; set operation arms have separate scopes; depth cap.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/safety/walk.test.ts
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass; no `any` in `walk.ts`.

REPORT: List of node types that create scopes.

COMMIT: `feat(safety): AST walker with scope tracking`

---

### P2.3 Statement classification

SKILL: postgres-sql-safety
DEPENDS: P2.2
SOURCE: spec/03 section 5.3; spec/02 F5; spec/05 section 4 (2xx)
FILES:
- packages/core/src/safety/statements.ts
- packages/core/src/safety/classify.ts
- packages/core/test/unit/safety/classify.test.ts

GOAL: `classify()` enforces single statement, allowed top-level types, forbidden nodes (including inside CTEs), INTO and locking clauses, EXPLAIN ANALYZE, and fail-closed handling of unknown node types.

CONTEXT:
- Allowed top-level: `SelectStmt`, `ExplainStmt`, `VariableShowStmt`.
- `FORBIDDEN_NODE_TYPES`: exact names plus prefix rules from spec/03 section 5.3. Implement prefix rules explicitly (`startsWith('Create')`, `Alter`, `Drop`, `Grant`) and list the rest exactly.
- `KNOWN_NODE_TYPES`: an explicit allow-list of node types that may appear inside an allowed statement (expression, clause, and range nodes: `SelectStmt`, `ResTarget`, `ColumnRef`, `A_Star`, `A_Const`, `A_Expr`, `BoolExpr`, `NullTest`, `BooleanTest`, `SubLink`, `CaseExpr`, `CaseWhen`, `CoalesceExpr`, `MinMaxExpr`,  `TypeCast`, `TypeName`, `FuncCall`, `WindowDef`, `SortBy`, `RangeVar`, `RangeSubselect`, `RangeFunction`, `RangeTableSample`, `JoinExpr`, `WithClause`, `CommonTableExpr`, `Alias`, `String`, `Integer`, `Float`, `Boolean`, `BitString`, `List`, `RowExpr`, `A_ArrayExpr`, `A_Indices`, `A_Indirection`, `CollateClause`, `GroupingSet`, `GroupingFunc`, `SQLValueFunction`, `ParamRef`, `XmlExpr`, `XmlSerialize`, `JsonObjectConstructor` and other SQL/JSON nodes present in PG18, `DefElem` (only under ExplainStmt options), `VariableShowStmt`, `ExplainStmt`). Generate the candidate list by parsing the allowed corpus cases and review it; anything not on the list fails closed with PGM-201 naming the node.
- Checks in order: statement count (PGM-204), top-level type (PGM-201), EXPLAIN options: `analyze` present and not explicitly false (PGM-209); then walk: forbidden node (PGM-203 if any ancestor is `CommonTableExpr`, else PGM-201), `SelectStmt.intoClause` (PGM-202), `SelectStmt.lockingClause` (PGM-202), unknown node (PGM-201). Function checks come in P2.4 (leave a hook).
- Return `{ ok: true, statementType } | { ok: false, code, message, node }`. No exceptions for policy outcomes.

TASKS:
1. Implement both files.
2. Tests (at least 40): every forbidden statement family; `COMMIT; DROP SCHEMA public CASCADE` (PGM-204); `SELECT 1; SELECT 2` (PGM-204); writing CTE (PGM-203); nested writing CTE; `SELECT * INTO t FROM x` (PGM-202); `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, `FOR KEY SHARE` (PGM-202); `EXPLAIN ANALYZE SELECT 1` (PGM-209); `EXPLAIN (ANALYZE false) SELECT 1` (allowed); `EXPLAIN DELETE FROM t` (PGM-201 via inner node); `SHOW work_mem` (allowed); `SET work_mem = '1GB'` (PGM-201).

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/safety/classify.test.ts
pnpm typecheck && pnpm lint
```

PASS/FAIL: All tests pass; unknown-node behavior covered by a test that injects a fake node type into an AST.

REPORT: Final `KNOWN_NODE_TYPES` list.

COMMIT: `feat(safety): statement classification with fail-closed node allow-list (FR-READ-02..08)`

---

### P2.4 Function allow-list

SKILL: postgres-sql-safety
DEPENDS: P2.3
SOURCE: spec/03 section 5.4
FILES:
- packages/core/src/safety/functions.ts
- packages/core/src/safety/classify.ts (wire the function rule)
- packages/core/test/unit/safety/functions.test.ts

GOAL: Only allow-listed functions pass; never-allowed functions are refused even if an operator allows them.

CONTEXT:
- `funcname` is a list of `String` nodes: `[name]` or `[schema, name]`. Lowercase both for comparison (Postgres folds unquoted identifiers; quoted mixed-case function names are not on the allow-list and are refused).
- Rule order: never-allowed (by name, any schema) first; then if qualified and schema is not `pg_catalog`, require exact `schema.name` in `policy.allowed_functions`; then unqualified or `pg_catalog`, require name in `ALLOWED_FUNCTIONS`.
- Also check `RangeFunction` contents (functions in FROM).
- `COALESCE`, `NULLIF`, `GREATEST`, `LEAST`, `CURRENT_DATE` and similar parse as special nodes, not `FuncCall`; they need no rule (they are in `KNOWN_NODE_TYPES`).
- Export the lists as frozen `Set`s and a `functionPolicy(config)` factory.
- Message for refusal: `PGM-205: Function "<name>" is not allowed. See https://pgmoat.dev/docs/safety#functions`.

TASKS:
1. Implement the lists exactly as spec/03 section 5.4 (all categories).
2. Wire into `classify` via the walker hook.
3. Tests: every never-allowed function refused, including schema-qualified forms (`pg_catalog.pg_sleep(1)`) and inside subqueries, CTEs, ORDER BY, and FROM; operator-configured `public.business_days` allowed only when listed; `set_config` refused even if listed; 30 allowed functions pass.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/safety/functions.test.ts test/unit/safety/classify.test.ts
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass.

REPORT: Count of allowed and never-allowed functions.

COMMIT: `feat(safety): function allow-list with permanent deny list (FR-READ-07)`

---

### P2.5 Access policy: relations

SKILL: postgres-sql-safety
DEPENDS: P2.2
SOURCE: spec/03 section 5.5 (relation resolution); spec/02 F6
FILES:
- packages/core/src/safety/policy.ts
- packages/core/test/unit/safety/policy-relations.test.ts
- packages/core/test/fixtures/policy-index.ts (test helper building a `PolicyIndex`)

GOAL: Every `RangeVar` resolves to an allowed relation or the query is refused with PGM-207.

CONTEXT:
- Input: AST, `PolicyIndex` (spec/05 section 2), `policy` config. The policy layer uses `PolicyIndex` (which includes hidden names) and never exposes hidden names in messages.
- Resolution per spec/03 section 5.5: CTE shadowing first; qualified names; unqualified names searched in `exposedSchemas` order; catalogs refused unless `allow_catalog_queries`; unknown or hidden refused with the same message: `PGM-207: Table not available. Use list_tables to see the tables you can query.`
- Hidden and unknown must be indistinguishable in message, code, and timing (no early exit difference that changes what is returned).
- Identifiers in `RangeVar.relname` are already case-folded by the parser for unquoted names; quoted names keep case. Compare exactly.

TASKS:
1. Implement `checkRelations(tree, scopesFromWalk, index, policy)`.
2. Tests (at least 25): hidden table direct, in join, subquery, CTE body, LATERAL, set operation arm; schema-qualified hidden; unknown table; table in unexposed schema; `pg_catalog.pg_class`, `information_schema.tables`, unqualified `pg_class` (unqualified names resolve only within exposed schemas, so this is PGM-207 as unknown); catalog references allowed when the flag is on; CTE named `users` shadows hidden `users`; quoted mixed-case table names.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/safety/policy-relations.test.ts
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass; a test asserts identical messages for hidden and unknown.

REPORT: Resolution order implemented, with an example trace.

COMMIT: `feat(safety): relation access policy (FR-POLICY-01..03, 07, 08)`

---

### P2.6 Access policy: columns, whole-row, star

SKILL: postgres-sql-safety
DEPENDS: P2.5
SOURCE: spec/03 section 5.5 (column table); spec/02 F6; spec/03 section 21 TQ-02
FILES:
- packages/core/src/safety/policy.ts
- packages/core/test/unit/safety/policy-columns.test.ts

GOAL: Hidden columns cannot be read through direct, qualified, whole-row, or star references; refusals list allowed columns.

CONTEXT:
- Implement the five rules in spec/03 section 5.5. With `strict_unqualified_columns: true` (default), an unqualified column name matching any hidden column of any in-scope relation is refused.
- Whole-row references: a `ColumnRef` with one `String` field equal to an alias or bare relation name in scope whose relation has hidden columns; also `ColumnRef` with fields `[x, A_Star]` (`x.*`).
- Unqualified `A_Star` in a target list is refused when any FROM relation in the same scope has hidden columns. `count(*)` is a `FuncCall` with `agg_star: true`, not an `A_Star`, so it is allowed.
- Columns reached through CTEs or subqueries: if a CTE or subquery selects a hidden column, the inner reference is caught. A star inside a subquery over a table with hidden columns is caught in that inner scope.
- Message: `PGM-208: Column access not allowed. <reason>. Allowed columns for <schema.table>: a, b, c.` List up to 40 columns per relation.

TASKS:
1. Extend `policy.ts` with `checkColumns`.
2. Tests (at least 30): direct hidden column; qualified hidden; alias-qualified hidden; same name non-hidden in another table but qualified correctly (allowed); unqualified ambiguous with strict mode (refused) and non-strict (allowed when resolvable); `SELECT u FROM users u`; `to_jsonb(u)`; `row_to_json(u.*)`; `SELECT *` single table; `SELECT *` join where one table has hidden columns; `SELECT o.* FROM orders o JOIN users u ...` where only users has hidden columns (allowed); `count(*)` allowed; hidden column in WHERE, ORDER BY, GROUP BY, JOIN ON, window PARTITION BY; inside CTE and subquery.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/safety/policy-columns.test.ts test/unit/safety/policy-relations.test.ts
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass.

REPORT: Known false-positive patterns (to document in the safety page).

COMMIT: `feat(safety): column, whole-row, and star policy (FR-POLICY-04..06)`

---

### P2.7 Rewrite with invariant re-check

SKILL: postgres-sql-safety
DEPENDS: P2.3, P2.6
SOURCE: spec/03 section 5.6
FILES:
- packages/core/src/safety/rewrite.ts
- packages/core/test/unit/safety/rewrite.test.ts

GOAL: Inject or enforce LIMIT through AST mutation and deparse, then prove the rewritten SQL classifies identically.

CONTEXT:
- `pgsql-deparser` 18.3.x (`deparse` is async; read its types). It accepts the libpg-query parse result (verified: `{ version, stmts }` round-trips).
- LIMIT injection for `SelectStmt` without `limitCount`: set `limitCount = { A_Const: { ival: { ival: maxRows + 1 } } }` and `limitOption = 'LIMIT_OPTION_COUNT'`. Verified output: `... LIMIT 1001`.
- Constant LIMIT: `A_Const.ival.ival` (absent `ival` means 0). Greater than `maxRows`: PGM-302 with message `LIMIT <n> is above this server's limit of <maxRows> rows.`
- Non-constant LIMIT or `LIMIT_OPTION_WITH_TIES`: no change.
- `ExplainStmt` and `VariableShowStmt`: no rewrite; return original SQL.
- Invariant: re-parse the deparsed SQL, re-run `classify` and `checkRelations`/`checkColumns`; compare outcome and statement type; compare ASTs after normalizing locations and the LIMIT node. Any difference: PGM-210 and include both SQL strings in an internal log field (not in the agent message).
- Strip `location`/`stmt_location`/`stmt_len` fields before comparison.

TASKS:
1. Implement `rewrite(tree, ctx)` returning `{ sql, limitInjected }` or a refusal.
2. Tests: no limit injects `maxRows + 1`; small limit kept; large limit refused; non-constant limit kept; `FETCH FIRST 5 ROWS ONLY` treated as LIMIT; UNION gets one outer LIMIT; deparse round trip preserves semantics for 50 allowed queries from P2.11's list (use a local list until then); a forced deparser mismatch (mock) yields PGM-210.

VERIFY:
```bash
pnpm --filter @pgmoat/core add pgsql-deparser@^18.3.12
pnpm --filter @pgmoat/core exec vitest run test/unit/safety/rewrite.test.ts
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass; no string concatenation (lint clean).

REPORT: Deparser version; any queries whose deparse changed formatting materially.

COMMIT: `feat(safety): AST LIMIT rewrite with invariant re-check (FR-REWRITE-01..04)`

---

### P2.8 Fingerprint

SKILL: postgres-sql-safety
DEPENDS: P2.7
SOURCE: spec/03 section 5.7
FILES:
- packages/core/src/safety/fingerprint.ts
- packages/core/test/unit/safety/fingerprint.test.ts

GOAL: Same query shape, same 16-hex fingerprint, regardless of literals and whitespace.

CONTEXT:
- Clone the AST (`structuredClone`), replace every `A_Const` with `{ A_Const: { sval: { sval: '?' } } }`, strip locations, deparse, collapse whitespace, SHA-256 (`node:crypto`), first 16 hex chars.

TASKS:
1. Implement `fingerprint(tree)`.
2. Tests: literals differ, same fingerprint; whitespace differs, same; different column, different fingerprint; IN lists with different lengths produce different fingerprints (document this).

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/safety/fingerprint.test.ts
```

PASS/FAIL: Tests pass.

REPORT: Example fingerprints.

COMMIT: `feat(safety): constant-stripped SQL fingerprint (FR-REWRITE-05)`

---

### P2.9 Safety pipeline orchestrator

SKILL: postgres-sql-safety
DEPENDS: P2.4, P2.6, P2.7, P2.8
SOURCE: spec/03 section 4 steps 5 to 8; spec/05 section 2 (`SafetyResult`)
FILES:
- packages/core/src/safety/pipeline.ts
- packages/core/src/safety/index.ts
- packages/core/test/unit/safety/pipeline.test.ts

GOAL: `runSafety(sql, ctx)` runs parse, classify, policy, rewrite, fingerprint, and returns a `SafetyResult`.

CONTEXT:
- `ctx`: `{ policyIndex, policy, budgets, mode: 'query' | 'explain' }`. In `explain` mode, skip LIMIT rewrite and treat the input as the inner statement of EXPLAIN (wrap happens in the tool).
- Pure function: no I/O except the parser WASM.
- Record timing per stage in a returned `timings` object for benchmarks.

TASKS:
1. Implement.
2. Tests: one allowed and one refused example per stage; explain mode does not inject LIMIT; timings present.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/safety
pnpm typecheck && pnpm lint
```

PASS/FAIL: All safety unit tests pass.

REPORT: Test count for `safety/`.

COMMIT: `feat(safety): pipeline orchestrator`

---

### P2.10 Corpus format and runner (pipeline mode)

SKILL: postgres-sql-safety
DEPENDS: P2.9, P1.7
SOURCE: spec/03 section 15 (corpus format); spec/02 F18
FILES:
- packages/core/test/corpus/schema.ts (Zod schema for case files)
- packages/core/test/corpus/runner.ts
- packages/core/test/corpus/pipeline.corpus.test.ts
- packages/core/test/corpus/lint.corpus.test.ts
- packages/core/test/corpus/fixture-schema.ts (the `PolicyIndex` for the corpus fixture database: users with hidden `password_hash` and `mfa_secret`, hidden table `internal_audit`, orders, tickets, customers, events, api_keys hidden)
- packages/core/test/corpus/cases/allowed.yaml (5 starter cases)

GOAL: YAML corpus cases run through the pipeline and assert outcomes; a lint test enforces case quality.

CONTEXT:
- Case fields: `id` (unique, `group-nnn`), `group` (one of the F18 groups), `sql`, optional `config` (fixture path), `expect` with exactly one of `{ allowed: true }` or `{ refused: 'PGM-xxx' }`, optional `executes: true`, optional `db_blocks: true`, optional `note`.
- Lint: unique IDs; group matches file name; every refused case has a `note` explaining the attack; no duplicate SQL within a group.
- Runner reports per-group counts.

TASKS:
1. Implement schema, runner, and both tests.
2. Add 5 starter allowed cases to prove the loop.

VERIFY:
```bash
pnpm test:corpus
```

PASS/FAIL: Starter cases pass; lint test passes.

REPORT: Runner output.

COMMIT: `test(corpus): corpus format, runner, and lint (FR-CORPUS-01)`

---

### P2.11 Corpus seed, part 1

SKILL: postgres-sql-safety
DEPENDS: P2.10
SOURCE: spec/02 F18; spec/01 section 14.1; spec/00 F15 to F17, F22
FILES:
- packages/core/test/corpus/cases/allowed.yaml
- packages/core/test/corpus/cases/statements.yaml
- packages/core/test/corpus/cases/stacking.yaml
- packages/core/test/corpus/cases/cte.yaml
- packages/core/test/corpus/cases/locking.yaml
- packages/core/test/corpus/cases/explain.yaml

GOAL: At least 130 cases across these groups, all passing.

CONTEXT:
- `allowed` (60 now, 80 by P12): joins of every kind, CTEs including recursive, window functions, grouping sets, set operations, `VALUES`, `LATERAL`, `TABLESAMPLE`, JSON operators and functions, array ops, date math, full-text search, pgvector operators (`<->`, `<=>`), `SHOW`, `EXPLAIN` without ANALYZE, `count(*)`, `DISTINCT ON`, `FILTER (WHERE ...)`.
- `statements` (35): every forbidden family from spec/03 section 5.3.
- `stacking` (15): `COMMIT; DROP SCHEMA public CASCADE` (from the Datadog research), `COMMIT; SET statement_timeout TO 1`, `SELECT 1; DELETE FROM users`, statement after a line comment, after a block comment, semicolon inside a string literal (allowed, single statement), semicolon inside a dollar-quoted string (allowed), trailing semicolon (allowed, single statement).
- `cte` (12): writing CTEs with INSERT, UPDATE, DELETE, MERGE; nested; in a subquery's WITH; read-only recursive CTE (allowed).
- `locking` (8) and `explain` (8).
- Each refused case has a `note`.

TASKS:
1. Write the cases.
2. Fix any pipeline bug found (with a unit test reproducing it) or, if the case reveals a spec gap, stop and report it instead of guessing.

VERIFY:
```bash
pnpm test:corpus
```

PASS/FAIL: 130 or more cases, 100% pass.

REPORT: Count per group; bugs found and fixed.

COMMIT: `test(corpus): seed statements, stacking, cte, locking, explain, allowed (FR-CORPUS-01, FR-CORPUS-04)`

---

### P2.12 Corpus seed, part 2

SKILL: postgres-sql-safety
DEPENDS: P2.11
SOURCE: spec/03 sections 5.4 and 5.5; spec/02 F18
FILES:
- packages/core/test/corpus/cases/functions.yaml
- packages/core/test/corpus/cases/sql-exec.yaml
- packages/core/test/corpus/cases/policy.yaml
- packages/core/test/corpus/cases/budgets.yaml
- packages/core/test/corpus/cases/edge.yaml

GOAL: At least 130 more cases (260+ total), all passing.

CONTEXT:
- `functions` (40): every never-allowed category with qualified and unqualified forms, inside subqueries, ORDER BY, FROM (`SELECT * FROM pg_ls_dir('.')`); allowed functions from each category.
- `sql-exec` (15): `query_to_xml('select * from internal_audit', true, false, '')`, `cursor_to_xml`, `table_to_xml('internal_audit', ...)`, `database_to_xml`, `ts_stat('select ...')`, `dblink('...','select ...')`, `pg_catalog.query_to_xml(...)`.
- `policy` (50 now, 60 by P12): per spec/02 F6 table, using `hidden-password.yaml` and `hidden-tables.yaml`.
- `budgets` (10): LIMIT over budget, at budget, non-constant LIMIT, FETCH FIRST over budget, OFFSET large (allowed, warning added later in P4).
- `edge` (15): Unicode identifiers, quoted reserved words, very long IN list, nested subqueries 50 deep, empty string, whitespace only, comment only, a PG19-only syntax sample (expect PGM-206).

TASKS:
1. Write the cases; fix bugs with unit tests; report spec gaps.

VERIFY:
```bash
pnpm test:corpus
```

PASS/FAIL: 260 or more cases total, 100% pass.

REPORT: Count per group; any case you could not make pass and why.

COMMIT: `test(corpus): seed functions, sql-exec, policy, budgets, edge`

---

### P2.13 Property tests and safety benchmark

SKILL: postgres-sql-safety
DEPENDS: P2.12
SOURCE: spec/03 sections 15 and 18; spec/04 NFR-PERF-02
FILES:
- packages/core/test/property/safety.property.test.ts
- packages/core/bench/safety.bench.ts
- package.json (script: bench)

GOAL: Fuzzing finds no crashes or invariant violations, and parse + classify + policy stays under 3 ms p95 for 1 KB SQL.

CONTEXT:
- fast-check 4.x. Properties: (1) for random strings, `runSafety` never throws a non-`PgmoatError`; (2) for random combinations of allowed SELECT fragments (generator from a small grammar), the result is allowed and rewrite invariant holds; (3) inserting any forbidden statement keyword as a second statement always yields PGM-204 or PGM-206; (4) any generated query referencing `internal_audit` yields PGM-207.
- Bench with Vitest bench or `tinybench`: 1,000 iterations over 20 representative 1 KB queries; print p50, p95, p99; fail if p95 > 3 ms (allow an env var to skip the assertion on slow CI runners, but print).

TASKS:
1. Write properties (short run in `pnpm test`, long run with `FC_RUNS=10000`).
2. Write the bench.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/property
pnpm bench -- safety
```

PASS/FAIL: No property failures at default runs; bench p95 under 3 ms on the developer machine.

REPORT: Bench numbers; any shrunk counterexamples found and fixed.

COMMIT: `test(safety): property tests and benchmark (NFR-PERF-02)`

---

### GATE-P2 Safety audit (read-only)

SKILL: security-audit
DEPENDS: P2.1 to P2.13
SOURCE: spec/03 section 5; spec/01 section 14.1; spec/08 G-P2

Do not modify files. Report card:

| # | Check | How |
|---|---|---|
| 1 | 260+ corpus cases, 100% pass | `pnpm test:corpus` |
| 2 | Every bypass class in spec/01 section 14.1 has at least one case | map class to case IDs |
| 3 | No SQL string building in `packages/core/src/safety` | `pnpm lint` and manual grep for template literals |
| 4 | No decision uses regex or substring matching on SQL text | read every file in `safety/`; list any `.includes(`, `.match(`, `RegExp` on SQL strings |
| 5 | Unknown node types fail closed | point to the test |
| 6 | Never-allowed functions cannot be overridden | point to the test |
| 7 | Hidden and unknown relations produce identical messages | point to the test |
| 8 | Rewrite invariant check exists and is tested with a forced mismatch | point to the test |
| 9 | Coverage `safety/` >= 90% lines | `pnpm coverage` |
| 10 | Bench p95 < 3 ms | `pnpm bench -- safety` |
| 11 | Property tests pass | `vitest run test/property` |

Also list: the three riskiest code paths in `safety/` in your judgment and why, as input for Sowad's review.

End with "GATE-P2: PASS" or "GATE-P2: FAIL" and findings F-P2-nn.

---

# Phase P3: Postgres execution, RLS, doctor (Nov 2 to Nov 5)

### P3.1 Testcontainers harness and seed database

SKILL: postgres-runtime
DEPENDS: P0.4
SOURCE: spec/08 section 3 (P3); spec/02 F9, F14, F18
FILES:
- packages/core/test/integration/harness/postgres.ts
- packages/core/test/integration/harness/seed.sql
- packages/core/test/integration/harness/roles.sql
- packages/core/test/integration/harness/rls.sql
- packages/core/test/integration/harness/smoke.integration.test.ts
- .github/workflows/ci.yml (enable the integration job)

GOAL: Integration tests start a real Postgres (15, 16, 17, or 18 via `PGMOAT_TEST_PG`), seed a known schema with roles and RLS, and tear down cleanly.

CONTEXT:
- `@testcontainers/postgresql` 12.x. Image `postgres:${PGMOAT_TEST_PG:-17}`. Reuse one container per test file (global setup) to keep runs fast.
- Schema (matches the corpus fixture index from P2.10): `tenants`, `users` (with `password_hash`, `mfa_secret`), `orders` (`tenant_id`), `tickets` (`tenant_id`, `body` text), `customers` (`tenant_id`, `email`, `stripe_customer_id`), `api_keys` (`token_hash`), `internal_audit`, `events` (generated on demand with `generate_series`, 2M rows, only for budget tests), views `order_totals`, and `COMMENT ON` for a few tables and columns.
- Roles: `pgmoat_reader` (LOGIN, NOSUPERUSER, NOBYPASSRLS, SELECT on exposed tables, column REVOKE on hidden columns), `pgmoat_owner_like` (owns `orders`, for PGM-703 tests), `pgmoat_bypass` (BYPASSRLS, for PGM-702), `pgmoat_writer` (has INSERT/UPDATE, for PGM-706), `pgmoat_audit` (INSERT, SELECT on `pgmoat.audit`).
- RLS: enable and FORCE on `orders`, `tickets`, `customers`; policy `tenant_id = current_setting('app.tenant_id', true)::uuid`.
- Seed two tenants (A, B) with distinct rows.
- Export helpers: `startPostgres()`, `connectionUrl(role)`, `resetData()`.

TASKS:
1. Write the SQL files and harness.
2. Smoke test: connect as `pgmoat_reader`, set tenant A with `set_config` in a transaction, count orders, expect only A's rows.
3. Enable the CI integration job with a Postgres version matrix [15, 16, 17, 18] for `test:integration`.

VERIFY:
```bash
pnpm test:integration -- smoke
PGMOAT_TEST_PG=15 pnpm test:integration -- smoke
PGMOAT_TEST_PG=18 pnpm test:integration -- smoke
```

PASS/FAIL: Smoke passes on 15 and 18 locally (Docker required); CI job configured.

REPORT: Container start time; versions tested.

COMMIT: `test(integration): testcontainers harness with roles, RLS, and seed data`

---

### P3.2 Pools and control client

SKILL: postgres-runtime
DEPENDS: P3.1, P1.3
SOURCE: spec/03 section 6.1; spec/04 NFR-REL-02
FILES:
- packages/core/src/postgres/pool.ts
- packages/core/test/integration/pool.integration.test.ts

GOAL: A query pool with bounded size and acquire timeout, plus a control client for cancellations, both resilient to connection loss.

CONTEXT:
- `pg` 8.23.x. Read its types for `Pool` options and `PoolClient.release(err?)` semantics: passing a truthy value destroys the connection.
- `connection.ssl` overrides URL `sslmode` when set (`verify-full` requires `ssl: { rejectUnauthorized: true }`).
- `acquire(pool, timeoutMs)` maps timeout to PGM-503.
- Control client: a single `pg.Client`, lazily connected, reconnect with backoff (100 ms doubling to 30 s) on error. `cancelBackend(pid)` runs `SELECT pg_cancel_backend($1)` (parameterized).
- `pool.on('error')` logs to stderr via the logger and does not crash the process.
- Export `createPools(config, logger)` returning `{ query, control, end() }`.

TASKS:
1. Implement.
2. Integration tests: acquire timeout with `max: 1` and a held client yields PGM-503 within `acquire_timeout_ms + 200`; `release(true)` destroys (backend PID changes on next acquire); cancelBackend cancels a running `pg_sleep` started on another connection (test code may call `pg_sleep` directly; agent SQL never can).

VERIFY:
```bash
pnpm --filter @pgmoat/core add pg@^8.23.1 pg-cursor@^2.22.1 && pnpm --filter @pgmoat/core add -D @types/pg
pnpm test:integration -- pool
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass.

REPORT: Observed timings.

COMMIT: `feat(postgres): query pool and control client (FR-PROTO-08, NFR-REL-02)`

---

### P3.3 Read execution path

SKILL: postgres-runtime
DEPENDS: P3.2
SOURCE: spec/03 sections 4 and 6.2; spec/02 F5 (layers L5); spec/05 section 4 (3xx, 5xx)
FILES:
- packages/core/src/postgres/execute.ts
- packages/core/src/postgres/errors.ts (Postgres error mapping and sanitization)
- packages/core/test/integration/execute.integration.test.ts
- packages/core/test/unit/postgres/errors.test.ts

GOAL: `executeRead()` runs one statement inside `BEGIN READ ONLY` with transaction-local limits and RLS, fetches at most `max_rows + 1` rows through `pg-cursor`, and maps errors safely.

CONTEXT:
- Follow the sequence in spec/03 section 6.2 exactly. Read `pg-cursor` types for how to obtain field metadata (`cursor._result.fields` or the documented API) and adapt.
- `idle_in_transaction_session_timeout = max_query_ms + 1000`.
- Error mapping: SQLSTATE `57014` (query_canceled, from statement_timeout or cancel): PGM-303 unless the abort signal fired (then PGM-505). `55P03` (lock_not_available): PGM-303 with "lock wait" message. `25006` (read_only_sql_transaction): PGM-201 (defense-in-depth hit; log at warn level with fingerprint because it means layers 1 to 3 missed something). `42601`/`42P01`/`42703` etc. (syntax, undefined table, undefined column): return as `error` kind with the Postgres message (sanitized). Connection errors: PGM-504.
- Sanitization: remove `detail`, `where`, and any `Key (...)=(...)` text; truncate to 300 chars.
- On any error: ROLLBACK (ignore its failure), then `release(true)`.
- Map field `dataTypeID` to type names with a cached `pg_type` lookup (one query at startup for common OIDs, lazy for others).

TASKS:
1. Implement `executeRead(pools, sql, rls, budgets, signal)` returning `ExecResult`.
2. Unit tests for error mapping and sanitization.
3. Integration tests: rows returned; `max_rows + 1` cap (`SELECT * FROM generate_series(1, 10000)` with max_rows 200 returns 201 rows to the caller); statement timeout (`SELECT count(*) FROM generate_series(1, 1e8::bigint)` with 200 ms) yields PGM-303; lock timeout (in a second test session, hold `LOCK TABLE orders IN ACCESS EXCLUSIVE MODE`; a plain SELECT on `orders` then waits and fails) yields PGM-303 with the lock message; RLS variables applied; abort signal yields PGM-505 and the backend is gone from `pg_stat_activity`; error releases destroy the connection.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/postgres/errors.test.ts
pnpm test:integration -- execute
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass.

REPORT: How field metadata is read from the installed `pg-cursor`.

COMMIT: `feat(postgres): read-only execution with cursor cap, local limits, error mapping (FR-READ-09, FR-READ-10, FR-BUDGET-02..05)`

---

### P3.4 Schema introspection

SKILL: postgres-runtime
DEPENDS: P3.2
SOURCE: spec/03 section 6.3; spec/05 section 2 (`RelationInfo`, `ColumnInfo`)
FILES:
- packages/core/src/postgres/introspect.ts
- packages/core/test/integration/introspect.integration.test.ts

GOAL: `introspect()` returns raw catalog facts for exposed schemas in under 1 s for 100 relations.

CONTEXT:
- Run inside `BEGIN READ ONLY` with `statement_timeout` 10 s. All queries parameterized with `$1::text[]` schemas. These files may use the documented lint exception (SQL in static strings with bound parameters).
- Return raw catalog rows grouped per relation (annotations are merged in P6.1): relation kind (`r` table, `p` partitioned, `v` view, `m` matview, `f` foreign), comments, `reltuples`, `relrowsecurity`, `relforcerowsecurity`, owner name; columns with `format_type`, not null, default, comment, ordinal; PK and unique constraints; FKs with referenced relation and columns and `confdeltype`; indexes with definition.
- Also return `server_version_num` and `current_user`.

TASKS:
1. Implement.
2. Integration test against the seed: relation count, a FK, an index, RLS flags on `orders`, view kind, comments read.
3. Timing assertion on a generated 100-table schema (create in a temp schema).

VERIFY:
```bash
pnpm test:integration -- introspect
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass; 100-table introspection under 1 s.

REPORT: Timing.

COMMIT: `feat(postgres): catalog introspection (FR-SCHEMA-01)`

---

### P3.5 RLS resolver

SKILL: postgres-runtime
DEPENDS: P1.3
SOURCE: spec/03 section 8; spec/02 F9; spec/05 section 4 (4xx)
FILES:
- packages/core/src/rls/resolve.ts
- packages/core/test/unit/rls/resolve.test.ts

GOAL: Resolve session variables per request from trusted sources only, enforcing `required`.

CONTEXT:
- Input: `config.rls`, `transport`, `principal` (claims), `meta` (non-reserved request `_meta`), `env` snapshot taken at startup.
- `meta` key: `com.kitalonlabs.pgmoat/rls` (an object). If present while untrusted: PGM-404.
- Token claim paths support dots (`token.org.id` reads `claims.org.id`).
- Scalar check; numbers and booleans become strings; empty string is PGM-403; missing with `required` is PGM-401 (or PGM-405 for token sources).
- Output `ResolvedRls` with entries in config order and sources map.
- Pure function.

TASKS:
1. Implement `resolveRls(input)`.
2. Tests: each source; nested claim; required missing per source; empty; array value refused; untrusted meta refused; meta trusted in stdio; config order preserved.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/rls
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass.

REPORT: Test count.

COMMIT: `feat(rls): trusted-source session variable resolution (FR-RLS-01..05)`

---

### P3.6 Doctor checks

SKILL: postgres-runtime
DEPENDS: P3.4
SOURCE: spec/03 section 6.4; spec/02 F14; spec/05 section 4 (7xx)
FILES:
- packages/core/src/postgres/doctor.ts
- packages/core/test/integration/doctor.integration.test.ts

GOAL: `runDoctor()` returns `DoctorFinding[]` for PGM-701 to PGM-707 with copy-paste fixes.

CONTEXT:
- Inputs: pools, config, raw introspection, hidden column list (from config annotations; compute it here from config and introspection without the full snapshot builder).
- Queries per spec/03 section 6.4, parameterized. Use `has_column_privilege` and `has_table_privilege` with the current role.
- Fixes: generate SQL with identifiers quoted via a small `quoteIdent` helper (double quotes, doubled internal quotes). This is the one place pgmoat formats identifiers into SQL text, and the output is shown to humans, never executed by pgmoat. Add a lint-exception comment explaining this.
- Severity rules: 701 fail; 702 fail if any RLS config present else info; 703 and 704 fail only for `rls.protected_tables`; 705 warn (`strict` makes it fail in the CLI layer); 706 warn in read-only mode; 707 warn outside 15 to 18.
- Fast mode: skip per-column checks if more than 500 hidden columns, add an info finding saying so.

TASKS:
1. Implement.
2. Integration tests with each fixture role from P3.1: reader (only 705 if a revoke is missing on purpose in a variant), bypass role (702), owner role (703), RLS disabled table (704), writer role (706).

VERIFY:
```bash
pnpm test:integration -- doctor
pnpm typecheck && pnpm lint
```

PASS/FAIL: Each finding reproduced by a test.

REPORT: Example findings output.

COMMIT: `feat(doctor): role and RLS preflight checks (FR-DOCTOR-01, FR-DOCTOR-04)`

---

### P3.7 Corpus database mode (layer-4 proof)

SKILL: postgres-sql-safety
DEPENDS: P3.3, P2.12
SOURCE: spec/03 section 15; spec/04 FR-READ-11
FILES:
- packages/core/test/corpus/db.corpus.test.ts
- packages/core/test/corpus/cases/*.yaml (add `executes`/`db_blocks` flags)
- package.json (script: test:corpus:db)

GOAL: Prove that Postgres itself blocks every refused write when called directly, independent of the parser layers.

CONTEXT:
- For cases with `db_blocks: true` (all refused write, DDL, stacking, and writing-CTE cases), call `executeRead()` directly with the raw case SQL (test code only), as `pgmoat_writer` (a role that has write grants, to prove the transaction and protocol block it, not the role). Expect an error with SQLSTATE `25006` (read-only transaction) or the "cannot insert multiple commands into a prepared statement" error (`42601`), and verify no data changed (row counts and a schema checksum before and after).
- For cases with `executes: true` (allowed), run the rewritten SQL through `executeRead()` as `pgmoat_reader` with tenant A and expect success.
- Never add a runtime flag that bypasses safety layers; the bypass exists only because the test imports `executeRead` directly.

TASKS:
1. Implement the runner.
2. Tag cases: all refused cases in `statements`, `stacking`, `cte`, and write-related `explain` cases get `db_blocks: true`; 40 allowed cases get `executes: true`.

VERIFY:
```bash
pnpm test:corpus:db
PGMOAT_TEST_PG=15 pnpm test:corpus:db
```

PASS/FAIL: 100% pass on 15 and 17 locally; CI runs 15 to 18.

REPORT: Count of db_blocks and executes cases; any case where Postgres did not block (that is a critical finding: stop and report).

COMMIT: `test(corpus): database-mode corpus proving read-only enforcement in Postgres (FR-READ-11, FR-CORPUS-02)`

---

### P3.8 RLS isolation, session leak, and injection tests

SKILL: postgres-runtime
DEPENDS: P3.3, P3.5
SOURCE: spec/02 F9 acceptance; spec/04 FR-RLS-06, FR-RLS-07, SEC-INJECT-02
FILES:
- packages/core/test/integration/rls-isolation.integration.test.ts

GOAL: Prove tenant isolation and absence of session leakage under concurrency.

CONTEXT:
- Pool size 4. Run 1,000 `executeRead` calls with random interleaving of tenants A and B (concurrency 16); each returns only its tenant's rows.
- After a transaction for tenant A completes, acquire the same connection (force by `max: 1`) and check `current_setting('app.tenant_id', true)` is empty or NULL.
- Injection: tenant value `'; DROP TABLE orders; --` passes as a bound parameter, returns zero rows, `orders` still exists.

TASKS:
1. Write the tests.

VERIFY:
```bash
pnpm test:integration -- rls-isolation
```

PASS/FAIL: Zero cross-tenant rows; no leak; table intact.

REPORT: Duration and row counts.

COMMIT: `test(rls): isolation, leak, and injection suite (FR-RLS-06, FR-RLS-07)`

---

### GATE-P3 Postgres audit (read-only)

SKILL: security-audit
DEPENDS: P3.1 to P3.8
SOURCE: spec/03 sections 6 and 8; spec/08 G-P3

Report card:

| # | Check |
|---|---|
| 1 | Every agent SQL path goes through `executeRead` (grep for other `client.query(` calls with non-constant text) |
| 2 | `BEGIN READ ONLY` and `pg-cursor` used for agent SQL (cite lines) |
| 3 | RLS and limits set with `set_config(..., true)` and bound parameters only |
| 4 | Errored connections are destroyed (cite line) |
| 5 | Database-mode corpus passes; no case where Postgres failed to block |
| 6 | Isolation suite: zero leaks |
| 7 | Doctor findings each reproduced by a test |
| 8 | Error sanitization removes DETAIL and key values (cite test) |
| 9 | Integration suite passes on Postgres 15 and 18 |

End with "GATE-P3: PASS" or "GATE-P3: FAIL" and findings F-P3-nn.

---

# Phase P4: Budgets and output (Nov 4 to Nov 6)

### P4.1 Value conversion

SKILL: postgres-runtime
DEPENDS: P3.3
SOURCE: spec/03 section 11.2; spec/04 FR-OUTPUT-04
FILES:
- packages/core/src/output/values.ts
- packages/core/test/unit/output/values.test.ts

GOAL: Every Postgres value becomes a JSON-safe value with predictable rendering.

CONTEXT:
- Configure `pg` type parsers for this pool only (not globally): `int8` (20) and `numeric` (1700) as strings; `timestamptz` and `timestamp` as ISO strings; `date` as `YYYY-MM-DD`; `json`/`jsonb` parsed; `bytea` as `"<bytea N bytes>"`; arrays recursively; unknown types as their text form.
- Text rendering helpers: NULL as `(null)`; JSON compact; strings escaped for Markdown tables (`|` and newlines).

TASKS:
1. Implement `toJsonValue(value, typeName)` and `toCellText(value)`.
2. Tests for each type.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/output/values.test.ts
```

PASS/FAIL: Tests pass.

REPORT: Type mapping table.

COMMIT: `feat(output): JSON-safe value conversion`

---

### P4.2 Budgets: columns, cells, payload

SKILL: postgres-runtime
DEPENDS: P4.1
SOURCE: spec/02 F8; spec/05 section 4 (3xx)
FILES:
- packages/core/src/budgets/columns.ts
- packages/core/src/budgets/cells.ts
- packages/core/src/budgets/payload.ts
- packages/core/src/budgets/index.ts
- packages/core/test/unit/budgets/*.test.ts

GOAL: Apply post-query budgets in a fixed order and collect warnings.

CONTEXT:
- Order: drop extra row (PGM-301 if `rows.length > max_rows`), columns (keep first `max_columns` alphabetical, PGM-304), cells (truncate strings longer than `max_cell_chars` to that length plus `... [+N chars]`, PGM-307 once with a count), OFFSET warning (PGM-306, from the AST, passed in), then payload (serialize `structuredContent` with `JSON.stringify`, measure UTF-8 bytes, PGM-305 refusal if over).
- `applyBudgets(exec, budgets, extras) => { result: RowsResult } | { refused: PgmoatError }`.

TASKS:
1. Implement.
2. Tests: each budget at, below, and above its limit; combined warnings; payload measured in bytes with multi-byte characters.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/budgets
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass.

REPORT: Warning order example.

COMMIT: `feat(budgets): column, cell, and payload budgets (FR-BUDGET-03, 06..09)`

---

### P4.3 Output schemas and framed text

SKILL: mcp-server
DEPENDS: P4.2
SOURCE: spec/03 section 11.2; spec/02 F16; spec/06 section 5.3
FILES:
- packages/core/src/output/schemas.ts
- packages/core/src/output/text.ts
- packages/core/test/unit/output/text.test.ts
- packages/core/test/unit/output/schemas.test.ts

GOAL: Each tool has a Zod `outputSchema`, and row results render as framed, escaped text exactly as specified.

CONTEXT:
- Schemas: `RowsResultSchema` (query, sample_table), `ListTablesResultSchema`, `DescribeTableResultSchema`, `ExplainResultSchema`, all including `request_id` and `warnings`.
- Text format from spec/06 section 5.3: summary line, preamble sentence, `<<<pgmoat:data request_id=...>>>`, Markdown table, `<<<pgmoat:end>>>`, untrusted columns line, warnings line.
- Escape any occurrence of `<<<pgmoat:` in cell text as `<<<pgmoat\:`.
- Zero rows: summary only, no fence.

TASKS:
1. Implement schemas and `renderRows`, `renderListTables`, `renderDescribe`, `renderExplain`, `renderRefusal`.
2. Snapshot tests against spec/06 specimens; fence escaping test; schema validation of sample outputs.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/output
pnpm typecheck && pnpm lint
```

PASS/FAIL: Snapshots match the spec specimens (character for character where the spec shows exact text).

REPORT: Any intentional deviation from the spec specimens.

COMMIT: `feat(output): output schemas and untrusted-data framing (FR-OUTPUT-01..05)`

---

### GATE-P4 (read-only)

SKILL: security-audit
DEPENDS: P4.1 to P4.3

Report card: budget defaults equal spec/05; warnings codes correct; fence escaping tested; outputs validate against schemas; `bigint`/`numeric` as strings; payload measured in bytes. End with "GATE-P4: PASS/FAIL" and findings F-P4-nn.

---

# Phase P5: Audit (Nov 5 to Nov 9)

### P5.1 Audit entry builder

SKILL: security-audit
DEPENDS: P1.2
SOURCE: spec/05 sections 1.1 and 1.5; spec/03 section 9.1
FILES:
- packages/core/src/audit/entry.ts
- packages/core/src/audit/canonical.ts
- packages/core/test/unit/audit/entry.test.ts

GOAL: Build an `AuditEntry` from a finished `RequestContext` and produce canonical JSON for hashing.

CONTEXT:
- `canonicalJson(obj)`: keys sorted recursively, no whitespace, UTF-8, numbers as JSON numbers, `undefined` omitted, `null` kept.
- Entry fields exactly as spec/05 section 2 `AuditEntry`. `prev_hash`, `entry_hash`, and `seq` are filled by the chain (P5.3); leave them empty strings or 0 here.

TASKS:
1. Implement `buildEntry(ctx, outcome, meta)` and `canonicalJson`.
2. Tests: field mapping for success, refused, error, canceled; canonical JSON key order stable.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/audit/entry.test.ts
```

PASS/FAIL: Tests pass.

REPORT: Example entry.

COMMIT: `feat(audit): entry builder and canonical JSON`

---

### P5.2 Redaction

SKILL: security-audit
DEPENDS: P5.1, P2.1
SOURCE: spec/03 section 9.2; spec/02 F10
FILES:
- packages/core/src/audit/redact.ts
- packages/core/test/unit/audit/redact.test.ts

GOAL: Remove secrets from params, RLS context, SQL literals, and error text before hashing and writing.

CONTEXT:
- Key redaction: case-insensitive substring match against `redact_fields`; replace value with `"[REDACTED]"`; walk nested objects and arrays.
- SQL literal redaction: parse `sql_executed` with libpg-query; for each `A_Expr` where one side is a `ColumnRef` whose last field matches a redact field and the other side is an `A_Const` (or a list of constants for `IN`), replace constants with `'[REDACTED]'`; deparse. On parse failure, replace the whole SQL with `"[REDACTED: unparseable]"`.
- Pattern redaction: compile `redact_patterns` once; reject patterns longer than 500 chars at config load; apply to `sql_executed` and `error_message`.
- Postgres error text: already sanitized in P3.3; apply patterns again.

TASKS:
1. Implement `redactEntry(entry, auditConfig)`.
2. Tests: `WHERE password = 'hunter2'` redacted; `WHERE email IN ('a','b')` not redacted unless `email` is in fields; nested params; `rls_context` key `app.api_token` redacted; SSN pattern in an error message redacted; unparseable SQL replaced.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/audit/redact.test.ts
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass.

REPORT: Example before and after.

COMMIT: `feat(audit): key, SQL literal, and pattern redaction (FR-AUDIT-05, COMP-04)`

---

### P5.3 Hash chain and verify

SKILL: security-audit
DEPENDS: P5.1
SOURCE: spec/03 section 9.1; spec/02 F10
FILES:
- packages/core/src/audit/chain.ts
- packages/core/src/audit/verify.ts
- packages/core/test/unit/audit/chain.test.ts

GOAL: Chain entries per instance and detect any edit, deletion, or reordering.

CONTEXT:
- `Chain` holds `instanceId`, next `seq`, last hash (starts at `genesis:<instanceId>`), and a pending `droppedSinceLast` counter.
- `seal(entry)`: set `seq`, `prev_hash`, `dropped_since_last`, compute `entry_hash = sha256hex(prev_hash + "\n" + canonicalJson(entry without entry_hash))`, advance head, reset dropped counter.
- `noteDrop()`: increments the counter (called when the pipeline drops an entry after sealing would have happened; drops happen before sealing, so sealing never consumes a seq for a dropped entry; document this).
- `verify(entries)`: group by `instance_id`, sort by `seq`, recompute; report per instance: `intact`, `edited` (first bad seq), `gap` (missing seq not explained), `dropped_recorded` (entries carry `dropped_since_last > 0`), `reordered` (seq order differs from file order, informational).

TASKS:
1. Implement.
2. Tests: 1,000 entries intact; edit a field: edited at that seq; delete one: gap; swap two lines: hash mismatch; recorded drop reported separately; multiple instances.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/audit/chain.test.ts
```

PASS/FAIL: Tests pass.

REPORT: Verify report format.

COMMIT: `feat(audit): hash chain and verification (FR-AUDIT-03, FR-AUDIT-04)`

---

### P5.4 Audit pipeline

SKILL: security-audit
DEPENDS: P5.2, P5.3
SOURCE: spec/03 section 9.3; spec/07 section 9
FILES:
- packages/core/src/audit/pipeline.ts
- packages/core/test/unit/audit/pipeline.test.ts

GOAL: A bounded, async audit queue that never blocks requests and records drops.

CONTEXT:
- `emit(entry)`: redact, seal, estimate size (`Buffer.byteLength(JSON)`), enqueue or drop. Synchronous and fast; no awaits.
- Drop path: do not seal; `chain.noteDrop()`; increment `droppedTotal`; CRITICAL stderr line at most once per 60 s: `pgmoat CRITICAL audit buffer full; dropped N entries in the last minute (PGM-502)`.
- Flush loop: `setInterval(flushIntervalMs)` plus immediate flush at 1,000 entries; per destination, keep a pending batch on failure and retry with backoff (100 ms doubling, cap 30 s) while counting toward the buffer.
- `shutdown(deadlineMs = 5000)`: stop accepting, flush, close destinations.
- Destinations implement `{ name, write(entries): Promise<void>, close(): Promise<void> }`.
- Inject a clock and logger for tests.

TASKS:
1. Implement.
2. Tests with a fake destination: entries flushed in order; destination failure then recovery flushes backlog; buffer full drops and records; emit never awaits (measure); shutdown flushes.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/audit/pipeline.test.ts
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass.

REPORT: Backpressure behavior summary.

COMMIT: `feat(audit): bounded async pipeline with drop accounting (FR-AUDIT-06, NFR-REL-03)`

---

### P5.5 Destinations: stderr and file

SKILL: security-audit
DEPENDS: P5.4
SOURCE: spec/03 section 9.4; spec/02 F10
FILES:
- packages/core/src/audit/destinations/stderr.ts
- packages/core/src/audit/destinations/file.ts
- packages/core/src/audit/paths.ts (per-OS state directory)
- packages/core/test/unit/audit/file.test.ts

GOAL: NDJSON to stderr and to rotating files with safe permissions.

CONTEXT:
- State dir: Linux `$XDG_STATE_HOME/pgmoat/audit` or `~/.local/state/pgmoat/audit`; macOS `~/Library/Application Support/pgmoat/audit`; Windows `%LOCALAPPDATA%\pgmoat\audit`.
- File names `audit-YYYY-MM-DD.ndjson` (UTC) for daily rotation; `audit-YYYY-MM-DD-N.ndjson` for size rotation.
- Create directories with mode 0700 and files with 0600 (skip chmod on Windows).
- Append with `fs.promises.appendFile` on an open handle; `fsync` on rotation and on close.
- `prune(dir, olderThanDays, dryRun)` for the CLI.

TASKS:
1. Implement both destinations, paths, prune.
2. Tests with temp dirs and a fake clock: rotation at midnight UTC; size rotation; permissions on POSIX; prune selects the right files.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/audit/file.test.ts
```

PASS/FAIL: Tests pass.

REPORT: Default paths per OS.

COMMIT: `feat(audit): stderr and rotating file destinations (FR-AUDIT-02, FR-AUDIT-08)`

---

### P5.6 Destination: Postgres

SKILL: security-audit
DEPENDS: P5.4, P3.1
SOURCE: spec/05 section 1; spec/03 section 9.4
FILES:
- packages/core/src/audit/destinations/postgres.ts
- packages/core/src/audit/ddl.ts
- packages/core/test/integration/audit-postgres.integration.test.ts

GOAL: Batched, parameterized inserts into `pgmoat.audit` with idempotent DDL, using a separate pool and role.

CONTEXT:
- DDL exactly from spec/05 section 1.1, with schema and table names from config (validated identifiers `^[a-z_][a-z0-9_]*$`) and the tenant expression index using `tenant_key` (validated as a Postgres setting name; embed as a string literal via `quote_literal`-equivalent escaping in a fixed DDL template; this is the documented lint exception).
- If `create_schema: false` or the role lacks privileges, check the table exists and has the expected columns; if not, fail startup with a clear message and the DDL to run.
- Inserts: multi-row `INSERT ... VALUES ($1, $2, ...), (...)` built from a fixed column list with generated placeholders only (no values in text), max 500 rows per statement.
- Separate `pg.Pool` with `pool_max` from config.

TASKS:
1. Implement.
2. Integration tests: DDL runs twice without error; 1,200 entries insert in batches; `pgmoat_audit` role can insert but not update or delete; verify works reading rows back ordered by `instance_id, seq`; destination down (stop container or wrong port) and recovery.

VERIFY:
```bash
pnpm test:integration -- audit-postgres
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass.

REPORT: Insert throughput.

COMMIT: `feat(audit): postgres destination with idempotent DDL (FR-AUDIT-07, SEC-AUDIT-02)`

---

### P5.7 Audit benchmark and outage integration

SKILL: security-audit
DEPENDS: P5.5, P5.6
SOURCE: spec/04 NFR-PERF-06, FR-AUDIT-06
FILES:
- packages/core/bench/audit.bench.ts
- packages/core/test/integration/audit-outage.integration.test.ts

GOAL: Prove enqueue p95 under 1 ms and that an audit outage never affects query success.

TASKS:
1. Bench 10,000 `emit` calls with realistic entries (including redaction).
2. Integration: run 500 `executeRead` calls while the audit Postgres is unreachable; all queries succeed; drops begin only after the buffer limit; after recovery, backlog flushes and `verify` reports recorded drops, not tampering.

VERIFY:
```bash
pnpm bench -- audit
pnpm test:integration -- audit-outage
```

PASS/FAIL: p95 < 1 ms; outage test passes.

REPORT: Bench numbers.

COMMIT: `test(audit): enqueue benchmark and outage resilience (NFR-PERF-06)`

---

### GATE-P5 (read-only)

SKILL: security-audit
DEPENDS: P5.1 to P5.7

Report card: one entry per call path (point to the finally-block plan for P6.3); chain verify detects edit, delete, reorder; redaction happens before hashing; tokens never appear in entries (grep tests); enqueue p95; Postgres DDL matches spec/05 exactly (diff); audit role append-only. End with "GATE-P5: PASS/FAIL" and findings F-P5-nn.

---

# Phase P6: Schema and tools (Nov 6 to Nov 10)

### P6.1 Snapshot builder and post-introspection checks

SKILL: postgres-runtime
DEPENDS: P3.4, P1.4
SOURCE: spec/03 section 7; spec/05 sections 2 and 3.2
FILES:
- packages/core/src/schema/snapshot.ts
- packages/core/src/config/checks.ts (implement `checkAgainstSchema`)
- packages/core/test/unit/schema/snapshot.test.ts

GOAL: Merge catalog facts with annotations into a `SchemaSnapshot` with a private `PolicyIndex`, and run schema-dependent config checks.

CONTEXT:
- Resolve `tables` keys (qualified or unqualified via `connection.schemas`).
- Description precedence: YAML, then Postgres comment, then "Unannotated".
- `sensitive_columns` shorthand sets `sensitive: high`.
- Hidden relations and columns removed from `relations` and `byQualifiedName`; included in `policyIndex`.
- `referencedBy` and `foreignKeys` omit entries that point at hidden relations or hidden columns entirely (no placeholder, no count), so hidden names never leak.
- `checkAgainstSchema`: PGM-115 (annotate_strict), PGM-118 (protected table missing), warnings for annotated columns not in the database (STALE).

TASKS:
1. Implement.
2. Tests with synthetic introspection data: hidden filtering everywhere (relations, columns, FKs, referenced_by, indexes over hidden columns are omitted); description precedence; qualified and unqualified keys; checks.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/schema/snapshot.test.ts
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass; a test asserts no hidden name appears anywhere in `JSON.stringify(snapshot.relations)`.

REPORT: Snapshot shape example.

COMMIT: `feat(schema): snapshot builder with hidden filtering and schema checks (FR-SCHEMA-02, FR-SCHEMA-05)`

---

### P6.2 Schema cache

SKILL: postgres-runtime
DEPENDS: P6.1, P1.8
SOURCE: spec/03 section 7
FILES:
- packages/core/src/schema/cache.ts
- packages/core/test/unit/schema/cache.test.ts

GOAL: A TTL cache with single-flight refresh, failure tolerance, and annotation reload from watch.

CONTEXT:
- `get()` returns the current snapshot immediately; triggers a background refresh when older than TTL (stale-while-revalidate). Only one refresh in flight.
- On refresh failure: keep the old snapshot, log a warning, retry at next TTL.
- `applyAnnotations(newConfig)` rebuilds the snapshot from the last raw introspection without hitting the database (for `--watch`).

TASKS:
1. Implement with an injected clock and introspect function.
2. Tests: TTL expiry triggers one refresh under concurrent gets; failure keeps old; annotation reload.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/schema/cache.test.ts
```

PASS/FAIL: Tests pass.

REPORT: Concurrency behavior.

COMMIT: `feat(schema): TTL cache with single-flight refresh (FR-SCHEMA-06)`

---

### P6.3 run-tool wrapper

SKILL: mcp-server
DEPENDS: P5.4, P4.3
SOURCE: spec/03 sections 4 and 10.1; spec/05 section 2 (`RequestContext`)
FILES:
- packages/core/src/tools/run-tool.ts
- packages/core/src/tools/context.ts
- packages/core/test/unit/tools/run-tool.test.ts

GOAL: Every tool call gets a `RequestContext`, exactly one audit entry, and consistent error mapping.

CONTEXT:
- Read the installed MCP SDK v2 types for the handler context: `ctx.mcpReq.id`, `ctx.mcpReq._meta` (non-reserved meta), `ctx.mcpReq.envelope` (protocol version, clientInfo) and `ctx.mcpReq.signal` (or the equivalent). Adapt to the real names and report them.
- Principal: from AsyncLocalStorage (HTTP, set in P9.3) or `{ kind: 'local', sub: 'local' }`.
- `trace_id`: parse `traceparent` from `_meta` (W3C format) if present.
- Wrapper signature: `runTool(name, args, ctx, deps, core: (rc) => Promise<ToolOutcome>)` where `ToolOutcome` is `{ structured, text, rowsReturned?, payloadBytes?, warnings }`.
- Errors: `PgmoatError` becomes `{ isError: true, content: [{ type: 'text', text: renderRefusal(err) }], _meta: { 'com.kitalonlabs.pgmoat/error_code': code, 'com.kitalonlabs.pgmoat/request_id': id } }`. Unknown errors become PGM-506 with a generic message (log the stack to stderr, never to the client).
- Audit emit in `finally`, exactly once, with status mapped from outcome (`success`, `refused`, `error`, `canceled`).
- Success results include `structuredContent`, `content: [{ type: 'text', text }]`, `_meta` with request ID.

TASKS:
1. Implement.
2. Tests with a fake audit pipeline: success, refusal, unknown error, cancellation; exactly one emit in each; `_meta` keys present; unknown error message does not leak stack.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/tools/run-tool.test.ts
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass.

REPORT: The SDK context field names you found.

COMMIT: `feat(tools): run-tool wrapper with audit-once and error mapping (FR-AUDIT-01, FR-PROTO-10)`

---

### P6.4 list_tables and describe_table

SKILL: mcp-server
DEPENDS: P6.2, P6.3
SOURCE: spec/02 F7; spec/06 section 5.2
FILES:
- packages/core/src/tools/list-tables.ts
- packages/core/src/tools/describe-table.ts
- packages/core/test/unit/tools/discovery.test.ts

GOAL: Discovery tools return structured and text outputs per spec with hidden data excluded.

CONTEXT:
- `describe_table` resolves names with the policy layer's resolution logic (reuse it; do not duplicate). Hidden and unknown produce the identical PGM-207 message.
- Row estimates: `reltuples < 0` means unknown (`null`); round for text (`~48k`, `~1.2M`).

TASKS:
1. Implement both cores.
2. Tests against a synthetic snapshot: sorting, view kinds, hidden count, describe output fields, hidden table refusal identical to unknown.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/tools/discovery.test.ts
```

PASS/FAIL: Tests pass; output validates against schemas.

REPORT: Example text output.

COMMIT: `feat(tools): list_tables and describe_table (FR-SCHEMA-03, FR-SCHEMA-04)`

---

### P6.5 query tool

SKILL: mcp-server
DEPENDS: P6.3, P2.9, P3.3, P3.5, P4.2
SOURCE: spec/02 F11; spec/03 section 4
FILES:
- packages/core/src/tools/query.ts
- packages/core/test/integration/tool-query.integration.test.ts

GOAL: The `query` core runs the full lifecycle and returns budgeted, framed results.

CONTEXT:
- Steps: resolve RLS, run safety (`mode: 'query'`), execute, apply budgets, render. Fill `RequestContext` fields (`sqlExecuted`, `sqlFingerprint`, `rls`, `rowsReturned`, `payloadBytes`, `warnings`) for audit.
- RLS resolution happens before safety so missing tenant context refuses without parsing.

TASKS:
1. Implement.
2. Integration tests with the seed DB: `SELECT 1 AS one`; cap at 200 with PGM-301; LIMIT 5000 refused; hidden column refused; tenant scoping; timeout; zero rows.

VERIFY:
```bash
pnpm test:integration -- tool-query
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass.

REPORT: Example success and refusal outputs.

COMMIT: `feat(tools): query tool (FR-PROTO-02, FR-BUDGET-03)`

---

### P6.6 explain tool

SKILL: mcp-server
DEPENDS: P6.5
SOURCE: spec/02 F12; spec/03 section 11.1
FILES:
- packages/core/src/tools/explain.ts
- packages/core/test/integration/tool-explain.integration.test.ts

GOAL: Plan-only EXPLAIN with the same safety checks, capped at `max_explain_ms`.

CONTEXT:
- Run safety on the inner SQL with `mode: 'explain'`. Build the EXPLAIN statement as an AST: an `ExplainStmt` node wrapping the parsed inner statement with options `format json` and `costs true` (no `analyze`), deparse, and execute through `executeRead` with `max_query_ms = max_explain_ms` (map timeout to PGM-308).
- Summarize: top node type, total cost, plan rows, plan width; text renders an indented tree of up to 30 nodes.

TASKS:
1. Implement.
2. Integration tests: plan for a join; refused DELETE; timeout mapping (use a planner-heavy query or mock).

VERIFY:
```bash
pnpm test:integration -- tool-explain
```

PASS/FAIL: Tests pass; no `ANALYZE` anywhere in emitted SQL (assert).

REPORT: Example summary.

COMMIT: `feat(tools): explain tool (FR-READ-08)`

---

### P6.7 sample_table tool

SKILL: mcp-server
DEPENDS: P6.5
SOURCE: spec/02 F13
FILES:
- packages/core/src/tools/sample-table.ts
- packages/core/test/integration/tool-sample.integration.test.ts

GOAL: Up to 5 random rows with sensitive columns masked and hidden columns omitted, built as an AST.

CONTEXT:
- Build `SelectStmt` with explicit `ResTarget` per visible column, `RangeVar` for the relation (with `RangeTableSample` `SYSTEM(p)` when `rowEstimate > 1,000,000`, `p = clamp(100 / rowEstimate * 100 * 2, 0.0001, 10)`), `ORDER BY random()`, `LIMIT n`. Deparse, then run it through the normal safety pipeline too (defense in depth), then execute.
- Mask values for `sensitive: medium | high` as `"[masked]"` and mark columns `masked: true`.

TASKS:
1. Implement.
2. Integration tests: 5 rows; masking; hidden omitted; TABLESAMPLE on the 2M-row events table; empty table message.

VERIFY:
```bash
pnpm test:integration -- tool-sample
pnpm lint
```

PASS/FAIL: Tests pass; lint shows no string-built SQL.

REPORT: Generated SQL example.

COMMIT: `feat(tools): sample_table tool (FR-OUTPUT-05)`

---

### P6.8 Tool registration

SKILL: mcp-server
DEPENDS: P6.4 to P6.7
SOURCE: spec/02 F4, F11 to F13; spec/06 section 5.2; spec/04 FR-PROTO-02..05
FILES:
- packages/core/src/tools/register.ts
- packages/core/src/tools/descriptions.ts
- packages/core/test/unit/tools/register.test.ts

GOAL: Register the five tools in fixed order with titles, config-rendered descriptions, schemas, and annotations.

CONTEXT:
- `server.registerTool(name, { title, description, inputSchema, outputSchema, annotations }, handler)` per SDK v2 (read installed types).
- Input schemas (Zod): `query` and `explain` `{ sql: z.string().min(1).max(budgets.max_sql_chars) }`; `describe_table` `{ table: z.string().min(1).max(200) }`; `list_tables` `{ schema: z.string().optional() }`; `sample_table` `{ table, limit: z.number().int().min(1).max(5).optional() }`.
- Descriptions from spec/06 section 5.2 with `{placeholders}` filled from config; assert each is under 600 characters.
- Annotations per spec/04 FR-PROTO-05.

TASKS:
1. Implement `registerTools(server, deps)`.
2. Tests using a fake server object that records registrations: order, titles, description lengths, annotations, schemas.

VERIFY:
```bash
pnpm --filter @pgmoat/core exec vitest run test/unit/tools/register.test.ts
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass.

REPORT: Rendered descriptions with default config.

COMMIT: `feat(tools): register five tools with annotations (FR-PROTO-02..05)`

---

### GATE-P6 (read-only)

SKILL: security-audit
DEPENDS: P6.1 to P6.8

Report card: hidden names never appear in any tool output (run each tool against the seed with hidden config and grep outputs for `password_hash`, `mfa_secret`, `internal_audit`, `api_keys`, `stripe_customer_id`); exactly one audit entry per call; structured outputs validate; descriptions under 600 characters; `sample_table` and `explain` build SQL via AST. End with "GATE-P6: PASS/FAIL" and findings F-P6-nn.

---

# Phase P7: Stdio server and zero-config (Nov 10 to Nov 11)

### P7.1 Server factory and instructions

SKILL: mcp-server
DEPENDS: P6.8
SOURCE: spec/03 section 10.1; spec/02 F4
FILES:
- packages/core/src/server/create.ts
- packages/core/src/server/instructions.ts
- packages/core/test/unit/server/create.test.ts

GOAL: `createServer(deps)` returns an SDK v2 `McpServer` with tools registered and instructions set.

CONTEXT:
- `new McpServer({ name, version }, { capabilities: { tools: {} }, instructions })`. Read installed types to confirm.
- Instructions text from spec/02 F4, filled from config.

TASKS:
1. Implement.
2. Test with the SDK's in-memory or linked transport (if available) or by calling the list handler: five tools listed in order; instructions present.

VERIFY:
```bash
pnpm --filter @pgmoat/core add @modelcontextprotocol/server@^2.3.1 && pnpm --filter @pgmoat/core add -D @modelcontextprotocol/client@^2.3.1
pnpm --filter @pgmoat/core exec vitest run test/unit/server/create.test.ts
pnpm typecheck
```

PASS/FAIL: Tests pass.

REPORT: SDK version and any API differences from spec/03 section 10.

COMMIT: `feat(server): McpServer factory and instructions`

---

### P7.2 Runtime lifecycle and stdout guard

SKILL: mcp-server
DEPENDS: P7.1, P3.6, P5.5, P5.6, P6.2
SOURCE: spec/03 sections 3, 6.4, 10.2; spec/02 F4 edge cases
FILES:
- packages/core/src/runtime.ts
- packages/core/src/logger.ts
- packages/core/test/integration/runtime.integration.test.ts

GOAL: `createRuntime(config)` builds all dependencies, runs doctor according to policy, and shuts down cleanly.

CONTEXT:
- Logger: `pino` 10.x to fd 2 (`pino(pino.destination(2))`), level from config.
- Order: logger, `warmParser`, pools, introspect, snapshot cache, doctor (`on_start`: enforce refuses on fail findings unless `allowUnsafeRole`; warn logs; off skips), audit pipeline (destination by config), `instanceId` (ULID).
- `shutdown(reason)`: stop accepting, wait for in-flight (tracked counter) up to 10 s, `audit.shutdown(5000)`, `pools.end()`.
- stdout guard (stdio only): wrap `process.stdout.write` so writes not originating from the transport throw in development (`NODE_ENV !== 'production'`) and log CRITICAL in production. Expose `allowStdoutWrite(fn)` for the transport.
- Signals: SIGINT and SIGTERM call `shutdown`.

TASKS:
1. Implement.
2. Integration tests: start with seed config; doctor enforce refuses with bypass role; `allowUnsafeRole` starts and audit entries carry the override; shutdown flushes audit; stdout guard catches a stray `console.log` in dev.

VERIFY:
```bash
pnpm test:integration -- runtime
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass.

REPORT: Startup timing breakdown.

COMMIT: `feat(runtime): lifecycle, doctor on start, stdout guard (FR-DOCTOR-02, FR-PROTO-11, FR-PROTO-12)`

---

### P7.3 Stdio serving and zero-config entry

SKILL: mcp-server
DEPENDS: P7.2
SOURCE: spec/03 section 10.2; spec/02 F1, F4
FILES:
- packages/core/src/server/stdio.ts
- packages/core/src/zero-config.ts
- packages/core/src/index.ts (exports: `startStdio`, `createRuntime`, `loadConfig`, `buildZeroConfig`, `runDoctor`, `verify`, `runSafety`, tool cores for tests)

GOAL: `startStdio(runtime)` serves both protocol eras over stdio, and zero-config startup prints the notice to stderr.

CONTEXT:
- `serveStdio(() => createServer(deps), { legacy: 'serve', onerror })` from `@modelcontextprotocol/server/stdio`. Read the installed types; if the API differs, adapt and report.
- Transport writes go through `allowStdoutWrite` (or configure the guard to allow the SDK's writer).
- Zero-config notice per spec/06 section 2.4 to stderr.

TASKS:
1. Implement.
2. A manual check script `packages/core/scripts/dev-stdio.ts` that starts against a URL for local testing with the MCP Inspector.

VERIFY:
```bash
pnpm typecheck && pnpm lint
pnpm --filter @pgmoat/core exec tsx scripts/dev-stdio.ts --help || true
```

PASS/FAIL: Builds; compat tests in P7.4 prove behavior.

REPORT: How to run the Inspector against the dev script.

COMMIT: `feat(server): stdio serving for both protocol eras and zero-config notice (FR-PROTO-01, FR-ZERO-01, FR-ZERO-04)`

---

### P7.4 Protocol compatibility, concurrency, cancellation tests

SKILL: mcp-server
DEPENDS: P7.3
SOURCE: spec/02 F4 acceptance; spec/04 FR-PROTO-*
FILES:
- packages/core/test/integration/protocol.integration.test.ts
- packages/core/test/integration/harness/mcp-client.ts

GOAL: Prove both protocol eras, determinism, isolation under concurrency, clean stdout, and cancellation.

CONTEXT:
- Spawn the server as a child process (built entry or `tsx`) with stdio pipes, using `@modelcontextprotocol/client` with its stdio client transport. Configure one client for 2026-07-28 and one that forces the 2025-11-25 era (read client types for how to pin the protocol version; if pinning is not exposed, hand-write the 2025 `initialize` JSON-RPC exchange for that test).
- Every stdout line must parse as JSON-RPC (collect raw stdout in the harness).

TASKS:
1. Tests: list tools twice (identical, ordered); query success; refusal `_meta`; 100 concurrent queries with distinct request IDs and audit entries; cancel a long query (raise `max_query_ms` in test config) and confirm the backend disappears within 2 s; legacy-era client works; stdout cleanliness.

VERIFY:
```bash
pnpm test:integration -- protocol
```

PASS/FAIL: Tests pass.

REPORT: Protocol versions negotiated in each test.

COMMIT: `test(server): protocol compatibility, concurrency, cancellation (FR-PROTO-01..12)`

---

### GATE-P7 (read-only)

SKILL: security-audit
DEPENDS: P7.1 to P7.4

Report card: both eras pass; stdout clean; shutdown drains and flushes; cancellation within 2 s; doctor enforce behavior; zero-config notice matches spec/06. End with "GATE-P7: PASS/FAIL" and findings F-P7-nn.

---

# Phase P8: CLI (Nov 11 to Nov 13), ends at M1

### P8.1 CLI entry, output helpers, exit codes

SKILL: cli-ux
DEPENDS: P7.3
SOURCE: spec/02 F17; spec/06 sections 2.1 to 2.3, 2.12, 2.13
FILES:
- packages/cli/src/bin.ts
- packages/cli/src/output.ts
- packages/cli/src/exit.ts
- packages/cli/src/commands/version.ts
- packages/cli/test/bin.test.ts

GOAL: `pgmoat` parses commands, detects zero-config (`pgmoat <url>`), renders human and JSON output, and maps errors to exit codes.

CONTEXT:
- `commander` 15.x. A first positional argument matching `^postgres(ql)?://` with no subcommand means zero-config start.
- `output.ts`: `ok()`, `warn()`, `err(PgmoatError)` using the error template from spec/06 section 2.3; `--json` switches to NDJSON; `NO_COLOR` and `--no-color` honored; markers `ok`, `!`, `x`.
- Exit codes: 0, 1, 2, 3 (spec/06 section 2.13). Config errors (1xx) are 3; connection errors (PGM-101, PGM-504) are 2.
- `version` prints pgmoat version, Node version, parser grammar version (from `parseSql('SELECT 1')` result), supported protocol versions.
- Help text exactly as spec/06 section 2.12.

TASKS:
1. Implement.
2. Tests: help snapshot; version JSON shape; zero-config detection; exit code mapping.

VERIFY:
```bash
pnpm --filter pgmoat exec vitest run test/bin.test.ts
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass; help matches spec text.

REPORT: Help output.

COMMIT: `feat(cli): entry, output helpers, version (FR-CLI-01, FR-CLI-05, FR-CLI-06)`

---

### P8.2 start and validate

SKILL: cli-ux
DEPENDS: P8.1
SOURCE: spec/02 F17, F3; spec/06 sections 2.7, 2.8
FILES:
- packages/cli/src/commands/start.ts
- packages/cli/src/commands/validate.ts
- packages/cli/test/start-validate.test.ts

GOAL: `start` runs the server with the banner; `validate` checks config, connectivity, and annotations.

CONTEXT:
- `start`: options `--config`, `--url-env`, `--watch`, `--allow-unsafe-role`, `--log-level`. Banner to stderr per spec/06 section 2.7. Transport chosen by config (HTTP added in P9; until then, `transport: http` exits with "HTTP transport arrives in P9").
- `validate`: load config (errors exit 3), connect (exit 2 on failure), introspect, `checkAgainstSchema`; print per spec/06 section 2.8; `--strict` turns warnings into exit 1.

TASKS:
1. Implement both commands.
2. Tests (unit with mocked runtime, plus one integration test against the seed DB for validate).

VERIFY:
```bash
pnpm --filter pgmoat exec vitest run test/start-validate.test.ts
pnpm test:integration -- cli-validate
```

PASS/FAIL: Tests pass.

REPORT: Example outputs.

COMMIT: `feat(cli): start and validate commands`

---

### P8.3 doctor command

SKILL: cli-ux
DEPENDS: P8.1, P3.6
SOURCE: spec/06 section 2.9; spec/02 F14
FILES:
- packages/cli/src/commands/doctor.ts
- packages/cli/test/doctor.test.ts

GOAL: Human and JSON doctor reports with correct exit codes.

TASKS:
1. Implement rendering per spec/06 section 2.9; `--strict` makes warnings fail.
2. Tests with fixture findings.

VERIFY:
```bash
pnpm --filter pgmoat exec vitest run test/doctor.test.ts
```

PASS/FAIL: Tests pass.

REPORT: Output snapshot.

COMMIT: `feat(cli): doctor command (FR-DOCTOR-01)`

---

### P8.4 init wizard

SKILL: cli-ux
DEPENDS: P8.1, P3.4, P3.6
SOURCE: spec/02 F2; spec/06 sections 2.5, 2.6, 4.1
FILES:
- packages/cli/src/commands/init.ts
- packages/cli/src/init/render-yaml.ts
- packages/cli/src/init/merge.ts
- packages/cli/test/init.test.ts

GOAL: Produce an annotated `pgmoat.yaml`, merge safely, and print client snippets.

CONTEXT:
- `@clack/prompts` 1.x for prompts; `--yes` skips prompts with defaults.
- Render YAML with the `yaml` library's document API so comments (`# TODO: describe`, section rule, modeline `# yaml-language-server: $schema=https://pgmoat.dev/schema/pgmoat.v1.json`) are preserved; flow-style mappings for columns.
- Auto-hide regex: `/(password|passwd|secret|token|api_?key|hash|salt|ssn|card)/i` on column names.
- Merge rules from spec/02 F2 (operate on YAML documents to keep human comments).
- Never overwrite without confirmation; default answer Abort.
- Client snippets per spec/06 section 2.5.

TASKS:
1. Implement.
2. Tests: `--yes` on a synthetic introspection writes a config that `loadConfig` accepts; merge keeps edited description and comment; auto-hide marks `password_hash`; existing file without `--merge` and `--yes` aborts.
3. Integration test against the seed DB in under 10 s.

VERIFY:
```bash
pnpm --filter pgmoat exec vitest run test/init.test.ts
pnpm test:integration -- cli-init
```

PASS/FAIL: Tests pass.

REPORT: Generated YAML excerpt.

COMMIT: `feat(cli): init wizard with merge and auto-hide (FR-CLI-02, FR-CLI-03)`

---

### P8.5 audit command

SKILL: cli-ux
DEPENDS: P8.1, P5.3, P5.5, P5.6
SOURCE: spec/02 F10 commands; spec/06 section 2.10
FILES:
- packages/cli/src/commands/audit.ts
- packages/cli/test/audit.test.ts

GOAL: `audit tail`, `audit query`, `audit verify`, `audit prune` for file and Postgres destinations.

CONTEXT:
- File: read NDJSON streams (line by line, do not load whole files); filters by time, status, tool, tenant (`rls_context[tenant_key]`), principal; `--follow` tails the newest file.
- Postgres: parameterized `SELECT` with the same filters; `verify --postgres` streams ordered rows.
- Output formats: table (default), csv, ndjson.
- `prune` only for file destination; `--dry-run` lists files.

TASKS:
1. Implement.
2. Tests with fixture NDJSON (including a tampered file) and an integration test for Postgres verify.

VERIFY:
```bash
pnpm --filter pgmoat exec vitest run test/audit.test.ts
pnpm test:integration -- cli-audit
```

PASS/FAIL: Tests pass; tampered fixture reported at the right seq.

REPORT: Output snapshots.

COMMIT: `feat(cli): audit tail, query, verify, prune (FR-AUDIT-09)`

---

### P8.6 schema-export and test-corpus

SKILL: cli-ux
DEPENDS: P8.1, P3.7
SOURCE: spec/02 F17, F18; spec/06 section 2.11
FILES:
- packages/cli/src/commands/schema-export.ts
- packages/cli/src/commands/test-corpus.ts
- packages/cli/src/corpus/ (bundled copy of cases and fixture SQL, built at package time)
- packages/cli/test/schema-export.test.ts

GOAL: Export the visible schema as Markdown; run the bundled corpus safely against a scratch database.

CONTEXT:
- `schema-export`: same visibility rules as `describe_table`; one section per relation.
- `test-corpus`: refuse if the target has more than 10 non-system tables unless `--force`; create schema `pgmoat_corpus_<random>`, seed the fixture DDL into it, run pipeline and database modes with `search_path` set to that schema, drop it in `finally` and on SIGINT.
- Print per-group results per spec/06 section 2.11.

TASKS:
1. Implement both.
2. Unit test for schema-export; integration test for test-corpus against a scratch container, including interruption cleanup.

VERIFY:
```bash
pnpm --filter pgmoat exec vitest run test/schema-export.test.ts
pnpm test:integration -- cli-test-corpus
```

PASS/FAIL: Tests pass; schema dropped after interruption.

REPORT: test-corpus output.

COMMIT: `feat(cli): schema-export and test-corpus (FR-CORPUS-03)`

---

### P8.7 CLI snapshot tests against the UX spec

SKILL: cli-ux
DEPENDS: P8.1 to P8.6
SOURCE: spec/06 section 2
FILES:
- packages/cli/test/snapshots/*.test.ts

GOAL: Every transcript in spec/06 section 2 has a snapshot test (with variable parts normalized).

CONTEXT:
- Normalize paths, timestamps, ULIDs, durations, and versions before comparing.
- Where implementation intentionally differs from the spec text, update the spec in the same PR and say why.

TASKS:
1. Write snapshot tests for: zero-config notice, init happy path, init errors, start banner (stdio), doctor refusal at start, validate, doctor, audit tail, audit verify, test-corpus, help.

VERIFY:
```bash
pnpm --filter pgmoat exec vitest run test/snapshots
```

PASS/FAIL: All snapshots pass.

REPORT: List of spec text changes, if any.

COMMIT: `test(cli): snapshot tests from UX spec`

---

### GATE-M1 Alpha milestone (read-only, then tag)

SKILL: security-audit
DEPENDS: GATE-P0 to GATE-P7, P8.1 to P8.7
SOURCE: spec/08 section 4 (M1)

1. Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:corpus && pnpm test:corpus:db && pnpm test:integration && pnpm coverage`.
2. Report card: each command PASS/FAIL; coverage numbers (overall and `safety/`); corpus count.
3. Manual checklist for the developer (print it; do not attempt GUI steps):
   - Claude Desktop with JSON config pointing to `node packages/cli/dist/bin.mjs start --config ...` lists five tools and answers a question.
   - Claude Code: `claude mcp add pgmoat-dev -- node <path>/bin.mjs <url>` works.
   - Cursor: same via its MCP settings.
   - A `COMMIT; DROP TABLE orders` attempt returns PGM-204 in each client.
4. If all pass, print the commands to tag `v0.1.0-alpha.1` (do not push without the maintainer).

End with "GATE-M1: PASS/FAIL" and findings F-M1-nn.

---

# Phase P9: HTTP transport and OAuth (Nov 16 to Nov 18)

### P9.1 Streamable HTTP server

SKILL: oauth-resource-server
DEPENDS: GATE-M1
SOURCE: spec/03 section 10.3; spec/02 F15; spec/05 section 3.1 (`http`)
FILES:
- packages/core/src/server/http.ts
- packages/core/test/integration/http.integration.test.ts

GOAL: Serve MCP over stateless Streamable HTTP with Host and Origin guards, body limits, and health endpoints.

CONTEXT:
- `@modelcontextprotocol/node` 2.1.x: `NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined })`, `hostHeaderValidation`, `originValidation`, `localhostHostValidation`, `localhostOriginValidation`. Read installed types.
- Per request: create a fresh `McpServer` via `createServer(deps)` and a fresh transport; `await server.connect(transport)`; `await transport.handleRequest(req, res, body)`; close both when the response finishes.
- Body limit: read up to `max_body_bytes`; respond 413 beyond it before parsing.
- Routes: `POST {path}`, `GET /healthz` (200 `ok`), `GET /readyz` (200 if a pool connection can be acquired in 1 s, else 503), `GET /.well-known/oauth-protected-resource` (added in P9.2), everything else 404.
- Bind `http.host:http.port`. Loopback binds use the localhost guards; others use `allowed_hosts`/`allowed_origins` (empty `allowed_origins` means requests with an `Origin` header are rejected; requests without `Origin` are allowed, typical for server-to-server).
- `auth.mode: none` only on loopback (config check already enforces).

TASKS:
1. Implement `startHttp(runtime)` returning `{ close() }`.
2. Integration tests (no auth, loopback): tool list and query via `@modelcontextprotocol/client` Streamable HTTP client transport; 413 on large body; bad Host 403 (PGM-603); bad Origin 403; healthz and readyz.

VERIFY:
```bash
pnpm --filter @pgmoat/core add @modelcontextprotocol/node@^2.1.1
pnpm test:integration -- http
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass.

REPORT: Request latency for `SELECT 1` over HTTP.

COMMIT: `feat(server): stateless Streamable HTTP transport with guards (FR-AUTH-01, FR-AUTH-07, FR-AUTH-09)`

---

### P9.2 OAuth resource server

SKILL: oauth-resource-server
DEPENDS: P9.1
SOURCE: spec/03 section 10.4; spec/02 F15; MCP authorization spec (2026-07-28)
FILES:
- packages/core/src/server/auth.ts
- packages/core/src/server/prm.ts
- packages/core/test/unit/server/auth.test.ts

GOAL: Validate bearer JWTs (issuer, audience, expiry, signature via JWKS, scopes) and publish Protected Resource Metadata, with spec-compliant 401 and 403 responses.

CONTEXT:
- `jose` 6.x: `createRemoteJWKSet`, `jwtVerify`. Algorithms from config allow-list; never `none`; `clockTolerance` from config.
- Token only from `Authorization: Bearer`; reject tokens in query strings (ignore them and respond 401).
- Scopes from `scope` (space-delimited string) or `scp` (array or string).
- 401: `WWW-Authenticate: Bearer resource_metadata="<origin of public_url>/.well-known/oauth-protected-resource", scope="<required scopes joined by space>"`. 403: `WWW-Authenticate: Bearer error="insufficient_scope", scope="...", resource_metadata="..."`.
- PRM JSON: `{ resource: public_url, authorization_servers: [issuer], scopes_supported: required_scopes, bearer_methods_supported: ["header"] }`.
- Never log tokens. Log only `sub`, `iss`, and the failure reason category.
- Audit: an auth failure produces an audit entry with tool `auth`, status `refused`, code PGM-601/602, principal `anonymous`.

TASKS:
1. Implement `authenticate(req, authConfig)` and the PRM handler; wire into `http.ts` before MCP handling.
2. Unit tests with a local key pair and a local JWKS server (`node:http`): valid token; wrong audience; wrong issuer; expired; not-yet-valid; unknown kid; `alg: none`; missing scope; `scp` array form; header case-insensitivity.

VERIFY:
```bash
pnpm --filter @pgmoat/core add jose@^6.2.12
pnpm --filter @pgmoat/core exec vitest run test/unit/server/auth.test.ts
pnpm typecheck && pnpm lint
```

PASS/FAIL: Tests pass; grep shows no token values in logs during tests.

REPORT: Header examples.

COMMIT: `feat(auth): OAuth resource server with PRM and scope checks (FR-AUTH-03..06, FR-AUTH-08, SEC-AUTH-01..04)`

---

### P9.3 Principal propagation and token-based RLS

SKILL: oauth-resource-server
DEPENDS: P9.2, P6.3, P3.5
SOURCE: spec/03 sections 8 and 10.3; spec/02 F9
FILES:
- packages/core/src/server/principal-context.ts (AsyncLocalStorage)
- packages/core/src/server/http.ts (wrap handling in the context)
- packages/core/src/tools/run-tool.ts (read principal)
- packages/core/test/integration/http-rls.integration.test.ts

GOAL: The authenticated principal reaches tool handlers, drives `token.*` RLS variables, and appears in audit.

TASKS:
1. Implement AsyncLocalStorage propagation.
2. Integration test: two tokens with `tenant_id` A and B; 200 interleaved concurrent queries; zero cross-tenant rows; audit `principal` equals token `sub`; token without `tenant_id` and `required: true` yields tool error PGM-405.

VERIFY:
```bash
pnpm test:integration -- http-rls
```

PASS/FAIL: Tests pass.

REPORT: Audit sample for an HTTP call.

COMMIT: `feat(auth): principal propagation and token-claim RLS (FR-RLS-01, FR-RLS-06)`

---

### P9.4 HTTP start path and Inspector check

SKILL: oauth-resource-server
DEPENDS: P9.3, P8.2
SOURCE: spec/06 section 2.7 (HTTP banner)
FILES:
- packages/cli/src/commands/start.ts (enable `transport: http`)
- packages/cli/test/start-http.test.ts
- docs/maintainers/http-manual-checks.md

GOAL: `pgmoat start` serves HTTP from config with the HTTP banner, and the maintainer can verify with the MCP Inspector.

TASKS:
1. Enable HTTP in `start`; banner lines for transport and auth.
2. Test: start with a loopback no-auth config and call `tools/list`.
3. Write manual checks: MCP Inspector (`npx @modelcontextprotocol/inspector`) against `http://127.0.0.1:8787/mcp`; with auth using a local Keycloak container (docker command included) and a token minted via client credentials.

VERIFY:
```bash
pnpm --filter pgmoat exec vitest run test/start-http.test.ts
```

PASS/FAIL: Test passes; manual check doc complete.

REPORT: Manual check steps.

COMMIT: `feat(cli): start HTTP transport`

---

### GATE-P9 (read-only)

SKILL: security-audit
DEPENDS: P9.1 to P9.4

Report card: audience validation; algorithm allow-list; no tokens in logs or audit; 401/403 headers match the MCP authorization spec; PRM correct; Host and Origin guards; body limit; stateless per request (no shared server instance across requests); token RLS isolation passes. End with "GATE-P9: PASS/FAIL" and findings F-P9-nn.

---

# Phase P10: Distribution (Nov 18 to Nov 20)

### P10.1 Bundle and npm package

SKILL: release-engineering
DEPENDS: GATE-M1
SOURCE: spec/03 section 17.1; spec/04 FR-DIST-01
FILES:
- packages/cli/tsdown.config.ts
- packages/cli/package.json (publishable)
- packages/core/src/version.ts (inject version at build)
- tools/smoke-pack.sh

GOAL: `pnpm build` produces `packages/cli/dist/bin.mjs`; `npm pack` produces a tarball that runs via `npx` in a clean container.

CONTEXT:
- tsdown 0.23.x: entry `src/bin.ts`, format `esm`, platform `node`, target `node22`, bundle `@pgmoat/core` and all pure-JS dependencies; externals: `libpg-query`, `pg`, `pg-cursor` (declared as dependencies). Add a shebang.
- `package.json` fields from spec/03 section 17.1 (`mcpName`, `bin`, `engines`, `files`, `publishConfig.provenance`). Remove `"private": true`.
- Smoke: build, `npm pack`, then in `docker run --rm -v $PWD:/w node:22-slim` install the tarball globally and run `pgmoat --version` and `pgmoat --help`; also `node:24-slim`.

TASKS:
1. Configure and build.
2. Write and run the smoke script.

VERIFY:
```bash
pnpm build
bash tools/smoke-pack.sh
du -h packages/cli/*.tgz
```

PASS/FAIL: Smoke passes on Node 22 and 24 images; tarball under 3 MB.

REPORT: Tarball size and contents list.

COMMIT: `build(cli): tsdown bundle and publishable package (FR-DIST-01, NFR-RES-01)`

---

### P10.2 Docker image

SKILL: release-engineering
DEPENDS: P10.1
SOURCE: spec/03 section 17.2
FILES:
- distribution/docker/Dockerfile
- distribution/docker/.dockerignore
- tools/smoke-docker.sh

GOAL: A multi-arch, non-root image that runs zero-config with `PGMOAT_DATABASE_URL` or a mounted config.

CONTEXT:
- Base `node:24-bookworm-slim` for build and runtime; install the packed tarball in the runtime stage; `USER node`; `ENTRYPOINT ["pgmoat"]`; default `CMD ["start", "--url-env", "PGMOAT_DATABASE_URL"]`; document `--config /etc/pgmoat/config.yaml` usage.
- Labels: `org.opencontainers.image.source`, `.licenses=MIT`, `.version`.

TASKS:
1. Write the Dockerfile.
2. Smoke: build for the local arch, run `--version`; run against the seed DB container on a shared network and list tools via a small client script.

VERIFY:
```bash
bash tools/smoke-docker.sh
docker run --rm pgmoat:dev id -u
```

PASS/FAIL: Smoke passes; UID is not 0.

REPORT: Image size.

COMMIT: `build(docker): non-root multi-arch image (FR-DIST-02, SEC-SUPPLY-05)`

---

### P10.3 MCPB bundle

SKILL: release-engineering
DEPENDS: P10.1
SOURCE: spec/03 section 17.3; spec/06 section 3
FILES:
- distribution/mcpb/manifest.json
- distribution/mcpb/icon.png (placeholder until the designed icon arrives)
- tools/build-mcpb.sh

GOAL: `tools/build-mcpb.sh` stages the bundled CLI with production dependencies and produces a signed `pgmoat-<version>.mcpb`.

CONTEXT:
- `@anthropic-ai/mcpb` 2.1.x (`mcpb validate`, `mcpb pack`, `mcpb sign`). Read the MCPB manifest spec in the package or its repository and use its exact field names; spec/03 section 17.3 lists the intended values.
- Stage: copy `packages/cli/dist`, write a minimal `package.json` with the three runtime dependencies, `npm install --omit=dev` inside the staging folder, copy `manifest.json` and `icon.png`.
- `user_config.database_url` is `sensitive: true` and passed through `env` to `PGMOAT_DATABASE_URL`; the command uses `--url-env PGMOAT_DATABASE_URL` so the URL never appears in argv.
- Tools list in the manifest mirrors the five tools with their titles and short descriptions.
- Signing: if no signing key is configured, produce an unsigned bundle and print a warning; CI signs with a key from secrets.

TASKS:
1. Write manifest and script.
2. Run `mcpb validate` and `mcpb pack`.

VERIFY:
```bash
bash tools/build-mcpb.sh
npx --yes @anthropic-ai/mcpb validate distribution/mcpb/manifest.json
ls -lh dist-mcpb/*.mcpb
```

PASS/FAIL: Validation passes; bundle produced.

REPORT: Bundle size; manual install steps for macOS and Windows Claude Desktop.

COMMIT: `build(mcpb): Claude Desktop bundle (FR-DIST-03)`

---

### P10.4 Registry metadata and release workflow

SKILL: release-engineering
DEPENDS: P10.1 to P10.3
SOURCE: spec/03 sections 17.4 and 17.5; spec/04 FR-DIST-04, SEC-SUPPLY-04, SEC-SUPPLY-06
FILES:
- distribution/registry/server.json
- .github/workflows/release.yml
- tools/sync-versions.mjs

GOAL: Tagging `v*` builds, tests, and publishes npm (with provenance), GHCR image, MCPB release asset, and MCP Registry metadata.

CONTEXT:
- Changesets drives versions; `tools/sync-versions.mjs` writes the version into `server.json` (top level and package entry) and `manifest.json`.
- `server.json` per spec/03 section 17.4; `name` must equal `mcpName` in `packages/cli/package.json`.
- Workflow permissions: `id-token: write` (npm provenance and registry OIDC), `contents: write`, `packages: write`.
- Registry publish: install `mcp-publisher` from its GitHub release, authenticate with the GitHub Actions OIDC method the registry documents, `mcp-publisher publish`. Read the registry's GitHub Actions guide and follow it exactly.
- Pre-release tags (`v0.9.0-beta.1`) publish npm with dist-tag `next`, GitHub pre-release, and skip the registry.

TASKS:
1. Write the workflow and helpers.
2. Dry run: `act` is optional; at minimum, run each step's command locally where possible (`npm publish --dry-run`, `docker buildx build --platform linux/amd64,linux/arm64` without push, `mcpb pack`, JSON schema validation of `server.json`).

VERIFY:
```bash
node tools/sync-versions.mjs 0.9.0 && git diff --stat
npm publish --dry-run --workspace packages/cli
npx --yes ajv-cli validate -s https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json -d distribution/registry/server.json || echo "validate server.json against the registry schema manually"
```

PASS/FAIL: Dry runs succeed; versions in sync.

REPORT: Release steps and required repository secrets.

COMMIT: `ci(release): npm provenance, GHCR, MCPB, and MCP Registry publishing (FR-DIST-04)`

---

### GATE-P10 (read-only)

SKILL: release-engineering
DEPENDS: P10.1 to P10.4

Report card: tarball installs and runs on Node 22/24 images; Docker non-root; MCPB validates; `server.json` name equals `mcpName`; release workflow uses SHA-pinned actions, provenance, and least-privilege permissions; versions synchronized. End with "GATE-P10: PASS/FAIL" and findings F-P10-nn.

---

# Phase P11: Docs site (Nov 19 to Nov 25)

### P11.1 Starlight scaffold and landing page

SKILL: docs-site
DEPENDS: P0.1
SOURCE: spec/02 F20; spec/06 section 7
FILES:
- packages/docs/ (Astro 7 + Starlight 0.42 project)
- packages/docs/src/content/docs/index.mdx
- packages/docs/astro.config.mjs (sidebar per spec/06 section 7.2)

GOAL: A static docs site with the information architecture and landing page from the UX spec.

CONTEXT:
- Site URL from an env var (`PGMOAT_SITE_URL`, default `https://pgmoat.dev`) so the domain decision (OD-01) does not block the build.
- Landing copy from spec/06 section 7.1. No marketing filler; no em dashes.
- Every page: last updated, edit link to GitHub, right-side TOC (Starlight defaults).

TASKS:
1. Scaffold; configure sidebar; write landing.
2. Add a `pnpm --filter docs build` script.

VERIFY:
```bash
pnpm --filter docs build
```

PASS/FAIL: Build succeeds.

REPORT: Page list.

COMMIT: `docs(site): Starlight scaffold and landing page`

---

### P11.2 Generated reference pages

SKILL: docs-site
DEPENDS: P11.1, P1.1, P1.3, P8.1
SOURCE: spec/06 section 7.3; spec/05 sections 3 and 4; spec/04 QA-04
FILES:
- tools/gen-docs.mjs
- packages/docs/src/content/docs/reference/config.md (generated)
- packages/docs/src/content/docs/reference/errors/*.md (generated, one per code)
- packages/docs/src/content/docs/reference/cli.md (generated from help)
- packages/docs/public/schema/pgmoat.v1.json (generated JSON Schema from Zod)
- .github/workflows/ci.yml (add `check:docs`)

GOAL: Config, error, and CLI references are generated from code so they cannot drift.

CONTEXT:
- JSON Schema: `z.toJSONSchema(PgmoatConfig)` (Zod 4). Read Zod types for the exact function.
- Error pages follow the template in spec/06 section 7.3; hand-written "When you see it / Fix" text lives in `packages/docs/src/content/error-notes/PGM-xxx.md` and is merged into the generated page; generation fails if a code lacks notes (forces documentation).
- `check:docs` regenerates and diffs.

TASKS:
1. Write the generator and notes for every code (use spec/05 section 4 cause and fix as the starting text).
2. Wire `check:docs` into CI.

VERIFY:
```bash
node tools/gen-docs.mjs && pnpm check:docs
pnpm --filter docs build
```

PASS/FAIL: Every error code and config field documented; check passes.

REPORT: Counts.

COMMIT: `docs(site): generated config, error, and CLI references (QA-04)`

---

### P11.3 Guides

SKILL: docs-site
DEPENDS: P11.2
SOURCE: spec/02 F20; spec/01 sections 4 and 5; spec/03 sections 5, 8, 9, 13; spec/07
FILES:
- packages/docs/src/content/docs/getting-started/*.mdx (quickstart, claude-desktop, claude-code-cursor-vscode, migrate-from-server-postgres)
- packages/docs/src/content/docs/configure/*.mdx (annotations, budgets, rls, http-oauth)
- packages/docs/src/content/docs/safety/*.mdx (guarantees, pipeline, functions, prompt-injection, threat-model, role-setup)
- packages/docs/src/content/docs/audit/*.mdx
- packages/docs/src/content/docs/operate/*.mdx

GOAL: Task-focused guides that let a developer install in 5 minutes and a security engineer approve with evidence.

CONTEXT:
- Quickstart: four client paths, each under 10 steps, copy-paste blocks.
- Migration guide: one-line swap, behavior differences (row cap, structured output, catalog refusal, refusals for unsafe SQL), why (Datadog advisory summary with a link).
- Safety guarantees page uses the tables from spec/01 sections 4.1 and 4.2 verbatim; include residual risks (custom operators, views and functions reading hidden data internally).
- Prompt injection page: the lethal trifecta, what pgmoat does, what the operator must do (do not combine with outbound tools for sensitive data).
- Role setup: the SQL from spec/03 section 13.3 and the doctor output explained.
- HTTP and OAuth: Auth0, Okta, Entra ID, Keycloak sections with the audience and claim mapping steps.
- Writing rules: second person, action-first, no em dashes, no marketing words.

TASKS:
1. Write the guides.
2. Add a link checker (`astro check` plus a markdown link check) to CI.

VERIFY:
```bash
pnpm --filter docs build
pnpm --filter docs exec astro check
grep -rn $'\u2014' packages/docs/src/content && echo "em dash found" && exit 1 || true
```

PASS/FAIL: Build and checks pass; no em dashes.

REPORT: Page list with word counts.

COMMIT: `docs(site): quickstart, migration, safety, RLS, HTTP, audit guides`

---

### GATE-P11 (read-only)

SKILL: docs-site
DEPENDS: P11.1 to P11.3

Report card: every config field and error code documented (`check:docs`); quickstart steps executable as written (dry read); Lighthouse >= 95 on landing, quickstart, config (`npx lighthouse` against `astro preview`); no broken links; no em dashes. End with "GATE-P11: PASS/FAIL" and findings F-P11-nn.

---

# Phase P12: Hardening and beta (Nov 23 to Nov 27), ends at M2

### P12.1 Corpus completion and bypass coverage

SKILL: postgres-sql-safety
DEPENDS: GATE-P3
SOURCE: spec/02 F18 (minimums); spec/01 section 14.1
FILES:
- packages/core/test/corpus/cases/*.yaml
- packages/core/test/corpus/coverage.corpus.test.ts

GOAL: 300+ cases meeting every group minimum, and a test that maps each bypass class to cases.

CONTEXT:
- Add a `bypass_class` field to cases where relevant; `coverage.corpus.test.ts` fails if any class in spec/01 section 14.1 has zero cases or any group is below its F18 minimum.
- Add cases inspired by public research since 2025 (MCP database server advisories, SQL injection writeups) and by GATE-P2 findings.

TASKS:
1. Add cases to reach the minimums.
2. Write the coverage test.

VERIFY:
```bash
pnpm test:corpus && pnpm test:corpus:db
```

PASS/FAIL: 300+ cases; minimums met; 100% pass on Postgres 15 to 18 in CI.

REPORT: Final counts per group and class.

COMMIT: `test(corpus): complete corpus to 300+ with bypass-class coverage (FR-CORPUS-01, FR-CORPUS-04)`

---

### P12.2 Benchmarks to targets

SKILL: postgres-runtime
DEPENDS: GATE-P9
SOURCE: spec/03 section 18; spec/04 NFR-PERF-*
FILES:
- packages/core/bench/query.bench.ts
- packages/core/bench/startup.bench.ts
- packages/core/bench/http.bench.ts
- .github/workflows/bench.yml (on PRs touching safety, postgres, audit; compares with main and comments)

GOAL: Measure every NFR-PERF target and guard regressions.

TASKS:
1. Implement benches (query overhead vs raw `pg`; cold start with 100 relations; HTTP throughput with `autocannon` against `SELECT 1`; idle RSS).
2. Workflow that fails on p95 regressions over 20%.

VERIFY:
```bash
pnpm bench
```

PASS/FAIL: All targets met on the developer machine; numbers recorded in `docs/maintainers/benchmarks.md`.

REPORT: Table of target vs measured.

COMMIT: `perf: benchmarks for NFR targets with regression guard`

---

### P12.3 Example projects

SKILL: docs-site
DEPENDS: GATE-M1
SOURCE: spec/01 section 3.4; spec/03 section 2 (`examples/`)
FILES:
- examples/vertical-ai-agent/
- examples/internal-analytics/
- examples/rag-retrieval/
- examples/support-agent/
- examples/multi-tenant-http/

GOAL: Five runnable examples, each with `docker-compose.yml` (Postgres with seed), `pgmoat.yaml`, `README.md`, and sample prompts.

CONTEXT:
- `rag-retrieval` uses the `pgvector/pgvector:pg17` image and demonstrates `<=>` queries with filters and the row cap.
- `multi-tenant-http` includes Keycloak, RLS policies, two users in different tenants, and a script that mints tokens and calls pgmoat.
- `support-agent` shows `untrusted: true` on ticket bodies and a seeded injection attempt in a ticket, with the README explaining the framing.
- Every README: what it shows, run steps (under 5 commands), what to ask the agent, what to expect.

TASKS:
1. Build the examples.
2. CI job that runs `docker compose up -d`, `pgmoat validate`, and one `query` call per example (nightly).

VERIFY:
```bash
for d in examples/*/; do (cd "$d" && docker compose up -d && npx pgmoat validate --config pgmoat.yaml; docker compose down -v); done
```

PASS/FAIL: All five validate.

REPORT: Example list with what each demonstrates.

COMMIT: `docs(examples): five runnable example projects (QA-05)`

---

### P12.4 Security self-review (audit only)

SKILL: security-audit
DEPENDS: GATE-P9, GATE-P10
SOURCE: spec/03 section 13; spec/01 section 14.1; OWASP Top 10 for Agentic Applications

Do not modify code. Produce `docs/maintainers/security-review-2026-11.md` containing a findings register:

| ID | Area | Finding | Severity (critical/high/medium/low) | Evidence (file:line or test) | Recommendation |
|---|---|---|---|---|---|

Review at minimum:
1. Every path from tool input to a database call (prove each passes the pipeline or AST builder).
2. Every place SQL text is created (lint exceptions included); justify each.
3. Parser failure modes and resource limits (very long input, deep nesting, huge IN lists).
4. Policy scoping edge cases (aliases reused in nested scopes, CTE recursion, LATERAL, set operations).
5. RLS resolution sources and config checks; HTTP auth (audience, algorithms, JWKS caching, clock skew).
6. Audit: redaction before hashing, chain head handling, drop accounting, token absence.
7. Output: fence escaping, Markdown injection in cells, structured output leakage of hidden names.
8. Supply chain: dependency list, install scripts, provenance, Docker base image.
9. Map each finding to OWASP ASI IDs where applicable.

End with counts by severity. Critical or high findings block M2.

COMMIT: `docs(security): self-review findings register`

---

### P12.5 Remediation (template, one prompt per finding)

SKILL: security-audit
DEPENDS: P12.4
SOURCE: docs/maintainers/security-review-2026-11.md
FILES: as required by the finding (list them before editing)

GOAL: Fix finding `<F-ID>` with a regression test and update the register.

TASKS:
1. Restate the finding and its evidence.
2. Write a failing test (unit, corpus, or integration) that reproduces it.
3. Fix with the smallest change that makes the test pass without weakening other checks.
4. Run the full suite.
5. Mark the finding `fixed` in the register with the commit hash and test name.

VERIFY:
```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:corpus && pnpm test:integration
```

PASS/FAIL: New test fails before the fix and passes after; full suite green.

REPORT: Diff summary and test name.

COMMIT: `fix(<area>): <short description> (<F-ID>)`

---

### P12.6 README, SECURITY, and contributor docs final pass

SKILL: oss-maintainer
DEPENDS: P11.3, P12.3
SOURCE: spec/02 F21; spec/06 section 7.1
FILES:
- README.md, SECURITY.md, CONTRIBUTING.md, GOVERNANCE.md
- docs/demo.gif (recorded by the maintainer; Claude Code writes the recording script `docs/maintainers/demo-script.md`)

GOAL: The repo front page converts a visitor in 30 seconds and tells a security reviewer exactly where to look.

CONTEXT:
- README order: tagline, install one-liner, demo GIF, "What pgmoat will not do," five guarantees (one line each with a docs link), quickstart per client (short), migrating from server-postgres, configuration example, safety model link, corpus (`npx pgmoat test-corpus`), contributing, license.
- Writing rules: no em dashes, no banned marketing words (AI-powered, seamless, effortless, instantly, cutting-edge, unlock, transform, revolutionize, elevate, leverage as a verb).

TASKS:
1. Write final versions.
2. Run a writing lint (`grep` for em dashes and banned words).

VERIFY:
```bash
grep -nE $'\u2014|seamless|effortless|instantly|cutting-edge|revolutioniz|unlock|elevate' README.md SECURITY.md CONTRIBUTING.md && exit 1 || echo clean
```

PASS/FAIL: Clean.

REPORT: README outline.

COMMIT: `docs: final README, SECURITY, and contributor guides`

---

### GATE-M2 Beta milestone (read-only, then pre-release)

SKILL: security-audit
DEPENDS: GATE-P9, GATE-P10, GATE-P11, P12.1 to P12.6
SOURCE: spec/04 section 9; spec/08 section 4 (M2)

1. Run the full suite and coverage; report numbers.
2. Confirm: all TRD P0 requirements pass (produce a table of P0 IDs with the test that proves each; mark any without a test as a finding); P1 items pass or have a written slip note.
3. Confirm: security review has zero open critical or high findings.
4. Print the manual checklist: doctor against Supabase, Neon, RDS (or the subset available); three external testers run the quickstart and time it; MCPB installs on macOS and Windows.
5. If all pass, print commands for the `v0.9.0` pre-release (npm `next`, GitHub pre-release with MCPB).

End with "GATE-M2: PASS/FAIL" and findings F-M2-nn.

---

# Phase P13: Launch (Nov 30 to Dec 8), ends at M3

### P13.1 Release candidate and v1.0.0

SKILL: release-engineering
DEPENDS: GATE-M2
SOURCE: spec/04 section 9; spec/01 section 12.2
FILES:
- CHANGELOG.md (via Changesets)
- docs/maintainers/release-checklist.md

GOAL: Ship v1.0.0 to every channel with the ship gate verified.

TASKS:
1. Fix beta findings (each with P12.5's template).
2. Write the release checklist covering G1 to G10 from spec/04 section 9 with a checkbox and evidence link per item.
3. Prepare the Changesets release and the tag command; the maintainer pushes the tag.
4. After the release workflow: verify npm (`npm view pgmoat version`, provenance badge), GHCR tags, MCPB asset, registry entry (`curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.kitalonlabs/pgmoat"`).

VERIFY:
```bash
npm view pgmoat version
docker pull ghcr.io/kitalonlabs/pgmoat:1.0.0
curl -s "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.kitalonlabs/pgmoat" | head -c 400
```

PASS/FAIL: All channels show 1.0.0.

REPORT: Links to each artifact.

COMMIT: `chore(release): v1.0.0`

---

### P13.2 Launch content drafts

SKILL: technical-writing
DEPENDS: P13.1
SOURCE: spec/01 sections 1, 2.4, 11.2; spec/00 section 2.3
FILES:
- launch/show-hn.md
- launch/migration-post.md
- launch/x-thread.md
- launch/linkedin-post.md
- launch/connectors-directory-submission.md

GOAL: Drafts the maintainer can edit and post, plus the Connectors Directory submission notes.

CONTEXT:
- Show HN title under 80 characters, factual: "Show HN: pgmoat, a read-only Postgres MCP server you can verify". Body: what it is, why (the archived server's bypass, the Supabase incident), how to verify (`npx pgmoat test-corpus`), what it will not do, ask for attacks.
- Migration post: "Moving off @modelcontextprotocol/server-postgres" with the one-line swap and the safety differences.
- Tone: plain, specific, no hype, no em dashes, no banned words.
- Connectors Directory notes: annotations on all tools (done), privacy policy URL (Kitalon privacy page; add a pgmoat section), test credentials approach (example database via the support-agent example), working examples per tool.

TASKS:
1. Write the drafts.

VERIFY:
```bash
grep -nE $'\u2014|seamless|effortless|instantly|cutting-edge|revolutioniz|unlock|elevate' launch/*.md && exit 1 || echo clean
```

PASS/FAIL: Clean; each draft under its platform limit.

REPORT: Character counts.

COMMIT: `docs(launch): launch drafts and directory submission notes`

---

### GATE-M3 Launch gate (read-only)

SKILL: security-audit
DEPENDS: P13.1, P13.2
SOURCE: spec/04 section 9

Report each of G1 to G10 with evidence. End with "GATE-M3: PASS/FAIL". On PASS, the maintainer posts launch content.

---

# Phase P14: v1.1 (Dec 9, 2026 to Jan 26, 2027), outlines

Expand each outline into full prompts (same format) after updating the spec for v1.1. Do not start P14 before M3.

### P14.1 Scoped-write spec update
Update spec/01 R3, spec/02 F22, spec/03 (new section for write tools and AST builders), spec/05 (codes 211 to 218 already reserved; add audit `rows_affected` semantics), spec/04 FR-WRITE. Gate: Sowad sign-off.

### P14.2 Write tools with AST builders
`insert`, `update`, `delete` tools with structured inputs; AST construction; read-write transaction with RLS and timeouts; affected-row preview; corpus group `writes`.

### P14.3 Human confirmation via MRTR
Return `inputRequired({ confirm: inputRequired.elicit(...) })` (SDK v2) describing the exact change; on retry with an accepting response, execute; otherwise PGM-218. Test with clients that do and do not support elicitation.

### P14.4 More audit destinations
Datadog (HTTP intake), S3 (daily NDJSON objects with chain continuity), OpenTelemetry logs (OTLP).

### P14.5 Metrics and tracing
Prometheus endpoint; OpenTelemetry spans continuing request `traceparent`.

### P14.6 Single-file binaries spike
Build with tsdown `exe` (Node 25.7+ toolchain); embed or locate the libpg-query WASM; smoke test on macOS, Linux, Windows; ship only if all pass.

---

## Appendix A: Recovery prompts

Use these when something goes wrong.

**Spec conflict.** "Stop. You found a conflict between the spec and the code or between two spec files. List the conflict with file and section references, propose the smallest spec change, and wait for approval. Do not change code until the spec is updated."

**Flaky integration test.** "Run `<test>` 20 times with `--repeat`. Report the failure rate and the first failing assertion. Identify whether the cause is timing, container reuse, or shared state. Fix the cause, not the symptom (no blanket retries or longer sleeps without justification)."

**SDK API mismatch.** "Open the installed type definitions for `<package>`. Print the exact exported names and signatures you need. Update the code to match and add a note to spec/03 in the relevant section."

**Coverage drop.** "List uncovered lines in `<path>` from the coverage report. For each, either add a test that exercises a real behavior or explain why it is unreachable and remove it."

## Appendix B: Commit and PR conventions

- Conventional Commits: `feat`, `fix`, `test`, `docs`, `build`, `ci`, `perf`, `chore`, `refactor`, with scope (`safety`, `postgres`, `rls`, `audit`, `tools`, `server`, `auth`, `cli`, `config`, `docs`).
- PR description: summary, TRD IDs, test evidence (commands and counts), spec changes (if any), safety checklist from the PR template.
- One prompt usually equals one PR. Gate prompts never produce PRs.
