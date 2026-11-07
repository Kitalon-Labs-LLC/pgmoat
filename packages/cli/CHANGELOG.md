# pgmoat

## 0.1.2

### Patch Changes

- 2bb51be: `pgmoat test-corpus` now runs the full public safety corpus: 321 cases instead of 289, the same cases as the repository's test suite.
- 1464437: The README describes the startup role check as it behaves (refuse with a `pgmoat.yaml` unless `--allow-unsafe-role` is passed, warn in zero-config mode), and security reports now go to sowad@kitalonlabs.com.

## 0.1.1

### Patch Changes

- 249b38a: pgmoat now exits after SIGINT or SIGTERM. Before, it shut down its connections but kept running, so Ctrl+C, `docker stop`, and MCP clients stopping the server left the process hanging until it was force-killed.
- 78c785b: Hidden columns now return the same error as columns that do not exist (`PGM-506: column "x" does not exist`), so an agent can no longer confirm which hidden columns exist by guessing names. The audit log still records these attempts as refused. `PGM-208` remains for `*`, whole-row references, column alias lists, and NATURAL JOIN on tables with hidden columns, and its fix text no longer shows an unfilled `<list>` placeholder.
