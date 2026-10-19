# Five-Minute Interactive Demo Script

This script provides a step-by-step walkthrough demonstrating the core safety, governance, and audit capabilities of `pgmoat`.

---

## Step 1: Start pgmoat in Zero-Config Mode (1 Minute)

Run `pgmoat` directly with a connection URL:

```bash
# Start pgmoat connecting to local PostgreSQL
npx -y pgmoat postgresql://readonly@localhost:5432/app
```

Expected behavior:
- `pgmoat` performs startup preflight diagnostics (Postgres version, role permissions, active extensions).
- Starts stdio JSON-RPC server listening on standard input.
- Emits initialization telemetry to stderr.

---

## Step 2: Execute a Governed Read Query (1 Minute)

Send a standard read-only MCP `tools/call` query:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "query",
    "arguments": {
      "sql": "SELECT id, name, created_at FROM users ORDER BY id LIMIT 5"
    }
  }
}
```

Expected behavior:
- `pgmoat` parses SQL into PostgreSQL AST via `libpg-query`.
- Validates statement type (`SelectStmt`) and visible schemas.
- Rewrites query enforcing strict row limits (`LIMIT 5`).
- Returns formatted tabular results wrapped in untrusted data framing.

---

## Step 3: Trigger Fail-Closed Attack Prevention (1 Minute)

Attempt to execute an unauthorized write or statement stacking exploit:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "query",
    "arguments": {
      "sql": "SELECT 1; DROP TABLE users CASCADE"
    }
  }
}
```

Expected behavior:
- Rejection prior to database transmission.
- Returns error code `PGM-204` ("Multi-statement query refused").
- Includes documentation link: `https://pgmoat.org/reference/errors/PGM-204`.

---

## Step 4: Verify Column Masking and Hidden Tables (1 Minute)

Attempt to access sensitive credential or secret columns:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "query",
    "arguments": {
      "sql": "SELECT name, password_hash FROM users"
    }
  }
}
```

Expected behavior:
- Returns error code `PGM-208` ("Access to hidden column is forbidden").
- Whole-row wildcards (`SELECT * FROM users` or `SELECT to_jsonb(u) FROM users u`) are identically rejected.

---

## Step 5: Verify Audit Log and Hash Chaining (1 Minute)

Inspect the audit stream (`audit.log` or stderr):

```bash
tail -n 2 audit.log | jq .
```

Expected output:
- Structured NDJSON entry containing:
  - `entry_id` (UUIDv7)
  - `sequence` number
  - `sha256_hash` computed over canonical record fields
  - `prev_hash` linking to the previous entry
  - `tool_name`, `sql_sha256`, and redacted parameter values
