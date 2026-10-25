# Contributing to pgmoat

Thank you for your interest in contributing to pgmoat!

## Developer Certificate of Origin (DCO)

All commits must be signed off to confirm compliance with the Developer Certificate of Origin:
```bash
git commit -s -m "feat(scope): your commit message"
```

## Safety Invariants

- **Corpus Cases:** Every change under `packages/core/src/safety/` must include corresponding positive or negative corpus test cases in `packages/core/test/corpus/cases/`.
- **No SQL String Building:** Building SQL with string concatenation or dynamic template literals is strictly forbidden by the `pgmoat/no-sql-string-building` lint rule.
- **Traceable Requirements:** Pull requests must reference the relevant TRD IDs (e.g. `SEC-INJECT-01`, `R12`) in their description.

## Running Tests

- Unit tests (no Docker required):
  ```bash
  pnpm test
  ```
- Adversarial corpus pipeline tests (no Docker required):
  ```bash
  pnpm test:corpus
  ```
- Database-backed integration tests (Docker required):
  ```bash
  pnpm test:integration
  ```
  No Docker? Point the tests at an existing Postgres 15+ server with a superuser
  named `postgres`. Use a scratch database: the tests reseed it and create
  `pgmoat_*` roles cluster-wide.
  ```bash
  PGMOAT_TEST_DATABASE_URL=postgres://postgres:pw@localhost:5432/pgmoat_test pnpm test:integration
  ```
- Typecheck and Lint:
  ```bash
  pnpm typecheck
  pnpm lint
  ```

## Changesets

Any user-facing change must include a changeset:
```bash
pnpm changeset
```
Follow the interactive prompts to describe whether your change is a patch, minor, or major version update.
