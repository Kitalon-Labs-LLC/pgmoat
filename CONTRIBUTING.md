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

## Releasing (maintainers)

Pushing a `v*` tag runs `.github/workflows/release.yml`, which publishes to npm (with provenance), GHCR, the MCP Registry, and GitHub Releases. Tags without a `-` (for example `v0.2.0`) publish as `latest`; tags with one (for example `v0.2.0-beta.1`) publish as `next` and skip the MCP Registry.

1. Merge `dev` into `main` through a pull request with green CI.
2. On `main`, apply the pending changesets (bumps `packages/cli` and writes its CHANGELOG), then copy that version to the other files:
   ```bash
   pnpm changeset version
   node tools/sync-versions.mjs
   git commit -am "release: v0.2.0"
   ```
3. Tag and push:
   ```bash
   git tag v0.2.0
   git push origin main v0.2.0
   ```
4. Check the Release workflow run, then the npm, GHCR, and GitHub release pages.

Follow semver. Before 1.0.0, breaking changes bump the minor version.
