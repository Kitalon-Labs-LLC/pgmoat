# Release Checklist (Gates G1 to G10)

This checklist defines the ten mandatory quality and safety gates required prior to cutting a release tag and publishing distribution artifacts.

---

## Gates Overview

| Gate | Name | Validation Command | Acceptance Criteria |
|---|---|---|---|
| **G1** | Clean Working Tree | `git status --porcelain` | Output must be empty; all commits signed and on target branch. |
| **G2** | Full Test Verification | `pnpm test && pnpm test:corpus` | 100% of unit, corpus, and pipeline tests pass. |
| **G3** | TypeScript Typecheck | `pnpm typecheck` | `tsc -b` exits with code 0 across all workspace packages. |
| **G4** | Linter & Safety Rules | `pnpm lint` | ESLint exits with code 0 and zero warnings or errors. |
| **G5** | Docs & Schema Sync | `pnpm check:docs` | Generated docs (`PGM-xxx.md`, `cli.md`, `config.md`, schema) match source code. |
| **G6** | npm Package Smoke Test | `tools/smoke-pack.sh` | Packed tarball size < 3 MB, installs and runs in clean Node 22/24 containers. |
| **G7** | Docker Image Verification | `tools/smoke-docker.sh` | Builds multi-stage image, runs as non-root UID 1000, passes healthchecks. |
| **G8** | MCPB Bundle Packaging | `tools/build-mcpb.sh` | Produces `dist-mcpb/pgmoat-<version>.mcpb` with verified manifest and icon. |
| **G9** | Version Synchronization | `node tools/sync-versions.mjs` | `package.json`, `manifest.json`, and `server.json` versions are identical. |
| **G10** | Performance Regression Guard | `vitest run packages/core/bench/` | All NFR targets met (p95 < 3 ms for 1 KB SQL, cold start < 1.0 s). |

---

## Step-by-Step Execution Sequence

1. **Verify Version Numbers**:
   ```bash
   node tools/sync-versions.mjs 0.1.0
   ```
2. **Execute Full Static Verification**:
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm check:docs
   ```
3. **Execute Test and Benchmark Suite**:
   ```bash
   pnpm test
   pnpm test:corpus
   ./node_modules/.bin/vitest run packages/core/bench/ --fileParallelism=false
   ```
4. **Build and Smoke Test Artifacts**:
   ```bash
   pnpm build
   bash tools/smoke-pack.sh
   bash tools/build-mcpb.sh
   ```
5. **Git Tag & Push**:
   ```bash
   git tag -s v0.1.0 -m "release: v0.1.0"
   git push origin main --tags
   ```
