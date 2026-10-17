# UI/UX Design: pgbridge
Doc owner: Sowad Al-Mughni
Status: Draft
Last updated: 2026-05-12
Companion docs: PRD (01), Feature Spec (02), Technical Architecture (03), TRD (04), Backend Schema (05)

pgbridge has no graphical UI in v1. It does have five distinct interaction surfaces, each with its own design contract. This document specifies the look, feel, and exact wording of each. Visual examples are rendered as code blocks so they survive copy-paste into PR templates and screenshots.

The five surfaces:

1. **CLI experience** (init wizard, command output, errors).
2. **Config-file authoring experience** (`pgbridge.yaml`).
3. **MCP tool surface** (what the agent sees in the tools list and tool descriptions).
4. **Audit log readability** (the SRE/auditor's view).
5. **Docs site information architecture** (`pgbridge.dev`).

A sixth section sketches the v1.5 cloud web UI for forward planning.

---

## 1) Design principles

These principles govern every surface. When two principles conflict, the earlier wins.

1. **Safety > convenience.** A surface that nudges toward unsafe defaults is worse than one that nudges toward safer-but-slower flows.
2. **Direct address.** Speak to the developer as "you" and refer to pgbridge as "pgbridge", not "us" or "we." Action verb first.
3. **Trust through specificity.** Errors and outputs use concrete numbers, file paths, line numbers, and SQL fragments. Vague phrasing erodes trust.
4. **Diff-friendly.** Every artifact a developer reads (config, audit, error) should be greppable, copy-pasteable, and stable across runs.
5. **No emojis in core CLI output.** Emojis read as marketing. The docs site and the README may use a sparse ✓ and ✗; the CLI defaults to ASCII.
6. **Errors include the remediation.** Every error names the cause AND the next step. Pointing at a doc URL is acceptable; pointing at "see logs" is not.
7. **Quiet by default.** Tools that succeed should produce one line of confirmation, not a paragraph.

### What pgbridge will not do (UX guardrails)

| pgbridge will not | Why |
|---|---|
| Auto-fix YAML errors | Silent fixes hide intent; require explicit author confirmation |
| Sample database rows without explicit consent | Privacy default; respects the production-data risk |
| Send any telemetry by default | Trust posture; opt-in only |
| Use emojis to indicate severity in errors | Color and code are enough; emojis are noisy |
| Print progress bars for sub-second operations | Adds latency, looks like marketing |
| Auto-update binaries | Operator-controlled update cycles |

---

## 2) CLI experience

### Tone and voice

| Surface | Voice |
|---|---|
| Success line | One sentence, action-verb past tense |
| Error message | Two lines: what + remediation, plus doc URL |
| Wizard prompt | Imperative, terse |
| Help text | Sentence case, period-terminated, no exclamation points |

### Color palette

ANSI 16-color only. Honor `NO_COLOR`.

| Token | Color | Use |
|---|---|---|
| `success` | green (32) | `✓ ` prefix on success lines |
| `warning` | yellow (33) | `! ` prefix on warnings (e.g. PGB-301) |
| `error` | red (31) | `✗ ` prefix on errors |
| `dim` | grey (90) | Secondary info, file paths in success lines |
| `bold` | bold | Headers and command names |
| `code` | cyan (36) | SQL fragments, identifiers, env vars |

### Standard error template

Every PGB-XXX error renders this way. The shape never changes; only the content does.

```
✗ PGB-201: Write operations disabled in read-only mode.

  Statement type: DeleteStmt
  Offending SQL: DELETE FROM users WHERE id = 'abc'
  Mode: read-only

  Fix: Set mode: scoped-write in pgbridge.yaml and add 'users' to
       the write allow-list. Read more at:

       https://pgbridge.dev/docs/error-codes#PGB-201
```

For machine consumption (`--json`), the same content as NDJSON:

```json
{"level":"error","code":"PGB-201","message":"Write operations disabled in read-only mode","details":{"statement_type":"DeleteStmt","sql":"DELETE FROM users WHERE id = 'abc'","mode":"read-only"},"docs":"https://pgbridge.dev/docs/error-codes#PGB-201"}
```

### Standard success template

```
✓ pgbridge started on stdio. 47 tables visible. Mode: read-only.
  Audit destination: /var/log/pgbridge/audit.log
  Config: /Users/sowad/projects/myapp/pgbridge.yaml
```

### Init wizard: full transcript

This is the canonical run. Every prompt has a default in brackets; pressing return accepts it.

```
$ npx pgbridge init

pgbridge init • v0.1.0

  Sets up pgbridge for a Postgres database. Writes pgbridge.yaml to the
  current directory and prints the Claude Desktop config block to paste.

? Postgres connection string  (postgres://user:pass@host:5432/db or ${DATABASE_URL})
> postgres://app:****@db.internal:5432/myapp

  Connecting...                                                       ✓
  Introspecting schema...                                              ✓

  Found: 47 tables, 312 columns, 2 schemas (public, billing).

? Server name (shown in your MCP client)  [myapp]
> myapp-prod

? Server description (max 280 chars)
> Production app database. Read-only.

? Mode  (read-only / scoped-write)  [read-only]
> [enter]

? Audit destination  (stdout / file / postgres / skip)  [file]
> file

? Audit file path  [/var/log/pgbridge/audit.log]
> ./pgbridge-audit.log

? Sample one row per table to suggest descriptions via Claude?  (y/N)
  This requires ANTHROPIC_API_KEY in env and sends column data to Anthropic.
  Default off respects production-data privacy.
> n

  Writing pgbridge.yaml...                                             ✓

  ✓ pgbridge.yaml created.   47 tables, 312 columns enumerated.
  ✓ .gitignore updated.       Added pgbridge-audit.log

Next steps:

  1. Edit pgbridge.yaml to add table descriptions and mark sensitive columns.

  2. Add this to your Claude Desktop config:
     ~/Library/Application Support/Claude/claude_desktop_config.json

       "mcpServers": {
         "myapp-prod": {
           "command": "pgbridge",
           "args": ["start", "--config", "/Users/sowad/projects/myapp/pgbridge.yaml"]
         }
       }

  3. Restart Claude Desktop. Your agent will see pgbridge tools.

Read more: https://pgbridge.dev/docs/quickstart
```

### Init wizard: error transcripts

**Connection refused:**

```
$ npx pgbridge init
pgbridge init • v0.1.0

? Postgres connection string
> postgres://app:****@db.internal:5432/myapp

  Connecting...                                                        ✗

✗ PGB-101: Connection refused at db.internal:5432.

  Fix: Verify the host is reachable. Try:
       pg_isready -h db.internal -p 5432

  Read more: https://pgbridge.dev/docs/error-codes#PGB-101
```

**Existing config:**

```
  Found existing pgbridge.yaml in this directory.

? What should I do?  (Abort / Merge / Overwrite)  [Abort]
> merge

  Merging schema introspection with existing annotations...            ✓
  Preserved: 47 table descriptions, 312 column descriptions.
  Added:     3 new tables, 12 new columns.
  Stale:     1 table no longer in DB (will be flagged as a warning at start).

  ✓ pgbridge.yaml updated.
```

**Empty schema:**

```
  Introspecting schema...                                              !

! No tables found in 'public' schema.
  Wrote a minimal pgbridge.yaml. Add tables to your DB and re-run
  `pgbridge init --merge` to populate annotations.
```

**Large schema:**

```
  Introspecting schema...                                              !

! Large schema detected: 847 tables. The agent's context window will be
  burdened on every list_tables call. Consider marking infrequently-used
  tables `hidden: true` in pgbridge.yaml to reduce that load.

  ✓ pgbridge.yaml created with all 847 tables.
```

### `pgbridge start` output

```
$ pgbridge start --config ./pgbridge.yaml
pgbridge • v0.1.0

  Config:     /Users/sowad/projects/myapp/pgbridge.yaml
  Mode:       read-only
  Database:   db.internal:5432/myapp
  Tables:     47 visible, 3 hidden
  Tools:      list_tables, describe_table, list_views, query, explain, sample_table, count
  Budgets:    1000 rows • 5000ms • 50 cols • 1MB
  Audit:      file → ./pgbridge-audit.log
  RLS:        configured (app.current_tenant_id, app.current_user_id), required=false

  ✓ Listening on stdio.
```

### `pgbridge validate` output

```
$ pgbridge validate --config ./pgbridge.yaml
✓ pgbridge.yaml is valid.
  Validated 47 table annotations against database schema.
  3 warnings:
    ! users.password_hash marked sensitive=high but not hidden=true (consider hiding)
    ! orders missing description (will appear as 'Unannotated')
    ! billing_keys: column 'stripe_secret' in DB but absent from yaml
```

Exit code 0 because the config validates; warnings do not gate.

```
$ pgbridge validate --config ./pgbridge.yaml --strict
✗ Validation failed (strict mode).
  3 unresolved warnings (run without --strict to see).
```

Exit code 1 in strict mode.

### `pgbridge audit` outputs

```
$ pgbridge audit tail --since 1h
2026-05-12T14:23:11Z  req_01HXY...  claude-desktop/0.7.4  query    success   47 rows  23ms
2026-05-12T14:24:02Z  req_01HXZ...  claude-desktop/0.7.4  query    refused   PGB-201  1ms
2026-05-12T14:25:11Z  req_01HY0...  claude-desktop/0.7.4  describe success   -        4ms

3 entries shown. Filter with --tool, --status, --since, --tenant.

$ pgbridge audit tail --status refused --since 24h
2026-05-12T09:11:22Z  req_01HXA...  claude-desktop  query  refused  PGB-201  DELETE FROM users
2026-05-12T14:24:02Z  req_01HXZ...  claude-desktop  query  refused  PGB-201  TRUNCATE events
2026-05-12T16:02:00Z  req_01HXB...  claude-desktop  query  refused  PGB-302  SELECT ... (5001ms)

3 refusals. Investigate at: ./pgbridge-audit.log
```

### Help text

```
$ pgbridge --help

pgbridge • Safe, governed MCP server for Postgres.

USAGE
  pgbridge <command> [options]

COMMANDS
  init             Set up pgbridge.yaml for a Postgres database.
  start            Start the MCP server (default: stdio transport).
  validate         Validate config and verify DB connectivity.
  audit            Inspect audit logs (subcommands: tail, prune).
  schema-export    Export schema to Markdown for human review.
  version          Print version.

OPTIONS
  --config <path>  Path to pgbridge.yaml. Defaults: ./pgbridge.yaml,
                   ~/.config/pgbridge/config.yaml, /etc/pgbridge.yaml.
  --json           Machine-readable NDJSON output.
  --no-color       Disable ANSI colors. (Also honored: NO_COLOR env var.)
  --help           Show this help.

Read more: https://pgbridge.dev/docs
Report issues: https://github.com/kitalonlabs/pgbridge/issues
```

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | User error (bad input, validation failure) |
| 2 | System error (Postgres unreachable, IO failure) |
| 3 | Config error (YAML invalid) |
| 4 | Permission error |
| 64+ | Reserved for sub-commands |

---

## 3) Config-file authoring experience

`pgbridge.yaml` is the most-edited surface by developers. It must read like a well-commented config, not like a generated dump.

### Anatomy of a clean pgbridge.yaml

```yaml
# pgbridge.yaml • generated by pgbridge init on 2026-05-12
# Edit freely. Run `pgbridge validate` to check.
# Docs: https://pgbridge.dev/docs/config

version: 1

server:
  name: myapp-prod
  description: |
    Production app database. Read-only.

connection:
  url: ${DATABASE_URL}
  schema: [public]
  statement_timeout_ms: 5000
  pool:
    min: 2
    max: 20
    queue_timeout_ms: 3000

mode: read-only

budgets:
  max_rows: 1000
  max_query_ms: 5000
  max_columns: 50
  max_payload_bytes: 1048576

rls:
  required: false
  session_variables:
    app.current_tenant_id: from_request.tenant_id
    app.current_user_id:   from_request.user_id

# ──────────────────────────────────────────────────────────────────────────
# Tables. Generated from your schema. Add descriptions to help your agent.
# Mark sensitive columns with `sensitive: high` (logged with REDACTION) or
# `hidden: true` (never visible to the agent at all).
# ──────────────────────────────────────────────────────────────────────────

tables:

  users:
    description: "TODO: describe me"
    columns:
      id:            { description: "" }
      email:         { description: "", sensitive: medium }
      password_hash: { hidden: true }
      created_at:    { description: "" }

  orders:
    description: "TODO: describe me"
    columns:
      id:         { description: "" }
      user_id:    { description: "" }
      total:      { description: "" }
      created_at: { description: "" }

  audit_log:
    hidden: true   # Internal table. Never shown to the agent.

annotate_strict: false   # Set true to refuse start if any table is unannotated.

audit:
  destination: file
  path: ./pgbridge-audit.log
  rotation: daily
  retain_days: 90
  redact_fields:
    [password, password_hash, fein, ssn, api_key, token, credit_card, card_number]
  redact_in_sql: true
  buffer_max_bytes: 10485760

logging:
  level: info
  format: ndjson

telemetry:
  enabled: false    # Opt-in only.
```

### Authoring affordances

| Affordance | Rendered as |
|---|---|
| Section dividers | `# ──────...` separators between major groups |
| TODO placeholders | `description: "TODO: describe me"` so unannotated rows are visible at a glance |
| Inline column dicts | Single-line `{ description: "...", sensitive: medium }` to keep diffs tight |
| Comment hints | Inline `# Internal table. Never shown.` on non-obvious flags |
| Trailing-newline pinned | Avoids spurious diffs |

### What `pgbridge validate` highlights

When the developer saves and validates, every annotation issue is surfaced with a line/column reference, even ones that don't gate start:

```
$ pgbridge validate
✓ Valid pgbridge.yaml.

Issues found (informational):
  ! pgbridge.yaml:42  users.description is "TODO: describe me" — your agent will see a placeholder
  ! pgbridge.yaml:67  orders has no relationship hints — consider adding them under `relationships:`
  ! pgbridge.yaml:103 column billing_keys.stripe_secret marked sensitive=high but hidden=false (consider hiding entirely)
```

---

## 4) MCP tool surface (the agent's view)

This is the most important UX surface in the product. The agent reads tool descriptions before invoking them. Every byte counts against context window. Wording shapes how the agent uses the tool.

### Design rules for tool descriptions

| Rule | Reason |
|---|---|
| ≤400 characters per tool description | Keeps the entire toolset under ~3KB; preserves agent context window |
| First sentence: what the tool does | Agent's snap judgment |
| Second paragraph: safety rails the agent should know | Avoid expensive trial-and-error |
| Embed current mode + key budgets | "this server is in read-only mode, 1000-row cap" prevents wasted refused queries |
| Deterministic; no randomization | Same description every connection; aids agent caching |
| End on actionable hint | "Use describe_table first if you need the schema" |

### Final tool descriptions (v1)

**list_tables**:
```
List tables in the connected Postgres database. Returns table names with their
one-line descriptions. Hidden tables are excluded. Use this first to discover
what data exists. Pair with describe_table for column-level detail.

Args: schema (optional, default 'public')
```

**describe_table**:
```
Get the full schema of one table: columns, types, nullability, primary key,
foreign keys, indexes, descriptions, sensitivity labels. Hidden columns
are excluded. Call this before writing complex SQL against the table.

Args: table (required, qualified name e.g. 'public.users')
```

**list_views**:
```
List views (regular and materialized) with descriptions. Same semantics as
list_tables but for views. Views often pre-compute joins, so prefer querying
a view when one matches your need.

Args: schema (optional, default 'public')
```

**query**:
```
Execute a SQL query against the connected Postgres database.

This server is in {{mode}} mode. {{mode_guidance}}

Safety:
- Queries are parsed and validated before execution.
- Auto-limited to {{max_rows}} rows; results over budget are truncated with a warning.
- Statement timeout: {{max_query_ms}}ms.
- Avoid SELECT * on wide tables; specify columns.

Use describe_table first to understand the schema.

Args: sql (required)
```

Where `{{mode_guidance}}` renders one of:

| Mode | Guidance text |
|---|---|
| read-only | "Only SELECT statements are allowed. Writes will be refused." |
| scoped-write | "SELECT, plus INSERT/UPDATE/DELETE on configured tables only. See list_tables for which writes are allowed." |

**explain**:
```
Run EXPLAIN (FORMAT JSON, ANALYZE FALSE) on a SQL query without executing it.
Use this to check query cost before running an expensive query. EXPLAIN runtime
is capped at {{max_explain_ms}}ms. Same SQL safety rules as query.

Args: sql (required)
```

**sample_table**:
```
Return up to 5 random rows from a table to understand its shape. Sensitive
columns are masked. Hidden columns are excluded. For tables with >1M rows,
uses TABLESAMPLE for performance.

Args: table (required)
```

**count**:
```
Run SELECT count(*) FROM <table> WHERE <conditions>. Shortcut for the most
common analytics question.

Args: table (required), where (optional SQL fragment)
```

**insert / update / delete** (scoped-write only): described in Feature Spec F5; descriptions follow the same template (what + safety + args).

### Tool response shape: visual specimens

What the agent literally sees when query returns successfully:

```
Returned 47 rows in 23ms.

| id  | email            | created_at          |
|-----|------------------|---------------------|
| 1   | alice@ex.com     | 2024-01-15 09:00:00 |
| 2   | bob@ex.com       | 2024-01-16 11:23:45 |
| ... | ...              | ...                 |
```

Auto-limit warning attached:

```
Returned 1000 rows in 142ms.
! Result capped at max_rows budget (1000). Refine with WHERE or LIMIT to see more.

| ... |
```

NULL rendering:

```
| id | email           | deleted_at |
|----|-----------------|------------|
| 7  | carol@ex.com    | (null)     |
| 8  | dave@ex.com     | 2024-03-12 |
```

Long string truncation:

```
| id | bio                                                                                                          |
|----|--------------------------------------------------------------------------------------------------------------|
| 12 | I have been a Postgres administrator for fifteen years and my hobbies include long walks ... [+1432 chars]  |
```

Refusal:

```
PGB-201: Write operations disabled in read-only mode.
The statement 'DELETE FROM users WHERE id = $1' is not permitted.

Set mode: scoped-write in pgbridge.yaml to enable. Or, if you wanted to read,
try: SELECT * FROM users WHERE id = $1
```

The refusal is intentionally helpful: it points the agent at the safest correction.

---

## 5) Audit log readability

The audit log is read by three audiences. Each gets a different rendering.

### Audience 1: SRE tailing live logs

NDJSON to stdout. One line per event. Human-tolerable, machine-perfect.

```
{"ts":"2026-05-12T14:23:11.412Z","rid":"req_01HXY","sid":"sess_01HXY","client":"claude-desktop/0.7.4","tool":"query","status":"success","rows":47,"ms":23,"sql":"SELECT count(*) FROM users WHERE deleted_at IS NULL","rls":{"tenant_id":"tnt_abc"}}
{"ts":"2026-05-12T14:24:02.108Z","rid":"req_01HXZ","sid":"sess_01HXY","client":"claude-desktop/0.7.4","tool":"query","status":"refused","code":"PGB-201","ms":1,"sql":"DELETE FROM users"}
```

### Audience 2: Auditor running compliance queries

Postgres destination + `pgbridge audit query` command:

```
$ pgbridge audit query --tenant tnt_abc --since 2026-05-01 --status refused
2 refusals for tenant tnt_abc between 2026-05-01 and 2026-05-12.

req_01HXZ  2026-05-12 14:24:02  query  PGB-201  DELETE FROM users
req_01HXA  2026-05-09 09:11:22  query  PGB-302  SELECT ... took 5001ms

To export as CSV:  pgbridge audit query ... --format csv > audit.csv
```

### Audience 3: Developer debugging a single agent session

```
$ pgbridge audit session sess_01HXY
Session sess_01HXY • claude-desktop/0.7.4 • tenant tnt_abc • 4 events

  14:23:11.412  list_tables             success   3ms     -
  14:23:14.001  describe_table users    success   8ms     -
  14:23:18.220  query                   success   47 rows 23ms
  14:24:02.108  query                   refused   PGB-201 DELETE FROM users

Show full SQL for an event:  pgbridge audit show req_01HXY
```

---

## 6) Docs site information architecture

`pgbridge.dev` is the conversion surface. The IA optimizes for "developer evaluating in <5 minutes" and "security engineer reading before approval."

### Landing page (`/`)

```
[hero]
  pgbridge
  Safe, governed Postgres access for AI agents.

  [install command — copy button]
  $ npm install -g pgbridge

  Production-grade. Read-only by default. RLS-aware. Audit-logged.
  MIT-licensed.

  [Get started →]  [Read the source →]

[three-column "five problems we solve"]
  Unsafe access     →  Read-only by default, parser-enforced
  No schema         →  Annotated descriptions from one YAML
  No budgets        →  Row/time/column/payload caps per query
  No RLS            →  SET LOCAL per query, tenant-scoped
  No audit          →  NDJSON + Postgres + Datadog + S3

[code sample: a single screen showing the YAML and what the agent sees]

[social proof strip — testimonials, GH stars counter, npm downloads]

[CTA: Quickstart 5 min   |   Read SECURITY.md]
```

### Nav (top-level)

```
Docs   Examples   Security   Blog   GitHub
```

### Docs IA (sidebar)

```
Getting started
  Install
  Quickstart (5 min)
  Your first agent query

Configuration
  pgbridge.yaml reference
  Environment variables
  Modes: read-only vs scoped-write

Safety
  What pgbridge guarantees
  What pgbridge will not do
  SQL safety pipeline
  Threat model

Schema and annotations
  Authoring descriptions
  Sensitive columns
  Hidden tables and columns
  Multi-schema setups

Row-level security
  Multi-tenant patterns
  Postgres RLS basics
  Required vs optional context

Budgets
  Row, time, column, payload
  Tuning for your workload

Audit
  Log fields reference
  Destinations
  Retention and pruning
  Compliance patterns (SOC 2, GDPR, HIPAA)

Operations
  Self-hosted deployment patterns
  Docker
  Capacity planning
  Disaster recovery

Reference
  CLI command reference
  MCP tool reference
  Error codes (PGB-XXX)
  Changelog
```

### Page templates

Every error-code page follows the same template, making the documentation predictable:

```
# PGB-201: Write operations disabled in read-only mode

When you see this
  Your agent attempted a write (INSERT, UPDATE, DELETE, etc.) but pgbridge
  is configured in read-only mode.

What pgbridge did
  Refused the query before sending it to Postgres. No data was changed.
  An audit entry was written.

Why
  Read-only is the default mode for safety. Write operations require
  explicit configuration.

How to fix
  Option A — keep read-only:
    If the agent should not write, this refusal is correct. Adjust the
    agent's prompt or behavior to avoid writes.

  Option B — allow specific writes:
    Edit pgbridge.yaml:
      mode: scoped-write
      tables:
        tickets:
          write: [insert, update]
          update_columns: [status, priority]

Related
  - PGB-211 Table not in write allow-list
  - PGB-212 Column not in update allow-list
  - Configuring scoped-write
```

### What every doc page has

| Element | Why |
|---|---|
| Last-updated date | Trust |
| "Edit this page" GitHub link | Community participation |
| Right-rail TOC | Long pages need it |
| Code blocks with copy button | Friction removal |
| "Was this helpful?" widget | Signal for prioritization |

---

## 7) v1.5 Cloud web UI (sketch)

Out of v1 OSS scope. Documented to inform forward design. Lives at `app.pgbridge.dev` (post-v1.5).

### Information architecture

```
Sign in
  ↓
Workspace selector
  ↓
Workspace dashboard
  ├─ Servers (list, status, last-event-at)
  ├─ Audit search
  ├─ Team and billing
  └─ Settings

Server detail
  ├─ Overview      (status, MCP URL, region, recent events)
  ├─ Config        (YAML editor with live validation)
  ├─ Schema        (introspected tables + annotation editor)
  ├─ Audit         (filterable list + per-event detail)
  ├─ Tunnels       (download tunnel client, status)
  └─ Settings      (regions, version pin, danger zone)
```

### Key screens (described, not wireframed)

**Server overview**

A single page that answers "is this server healthy and what is it doing right now":

- Status badge: provisioning / running / stopped / error.
- Region and runtime version with pin/unpin controls.
- "MCP URL to paste into your agent" — copy button.
- Live activity sparkline: requests per minute, refusal rate, p95 latency.
- Last 10 events as a compact list (rid, tool, status, ms); click for detail.
- Quick links: edit config, view full audit, view docs.

**Config editor**

Monaco editor with the pgbridge YAML schema attached. Live validation:
- Red underline + tooltip on schema violations.
- "Save and apply" applies a new revision; rollback list at right.
- Diff view between current and previous revision.

**Annotation editor**

Table-by-table form built on top of `pgbridge.yaml`:
- Left rail: tables (with status: annotated / unannotated / hidden).
- Center: per-column rows with description, sensitivity, hidden.
- "Suggest descriptions" button: kicks off an annotation job (Claude API) using sampled column values.
- Each suggestion shown with "accept / edit / reject."

**Audit search**

Faceted search over the audit_index table:
- Filters: time range, status, tool, tenant_id, error code, client.
- Result table: ts, tool, tenant, status, ms, sql preview.
- Click for full event detail with redaction preserved.

**Team and billing**

- Members list with role badges.
- Invite by email.
- Stripe-hosted billing portal embed.
- Usage meters: requests/month, audit volume, hosted servers.

### Design system

- Typography: Inter (UI), JetBrains Mono (code).
- Color: monochrome base with a single accent (deep indigo, matches the pgbridge logo).
- Density: high; this is a tool for engineers, not a consumer app.
- Dark mode by default; light mode toggle in user menu.

---

## 8) Accessibility

| Surface | Requirement |
|---|---|
| CLI color | Honor NO_COLOR; ASCII fallback for ✓/✗ on terminals without unicode |
| Docs site | WCAG 2.1 AA: color contrast ≥4.5:1; keyboard nav; alt text on every image |
| Cloud UI (v1.5) | Full keyboard nav; screen-reader labels on every interactive element; respect prefers-reduced-motion |

---

## 9) Open issues

| ID | Question | Owner | Due |
|---|---|---|---|
| UX-01 | Should the CLI ask before sending Postgres column values to Anthropic for description suggestions, or just refuse unless --suggest is passed? Current draft: prompt + opt-in. | Sowad | 2026-05-13 |
| UX-02 | Should refusal messages include the offending SQL verbatim, or just the statement type? Verbatim helps the agent self-correct; omitting reduces audit log size. Current: verbatim, with redact_in_sql applied. | Sowad | 2026-05-13 |
| UX-03 | Should the tool description embed the actual budget values or a generic phrase? Embedding is more useful to the agent but mutates with config. Current: embed actual values. | Sowad | 2026-05-13 |
| UX-04 | Docs site: launch with Algolia search or wait for v1.1? Algolia free tier is enough for v1; setup is half a day. Current: ship v1. | Sowad | 2026-05-20 |
| UX-05 | v1.5 cloud editor: Monaco bundle adds ~2MB. Worth it for the live-schema validation? Current: yes. | Sowad | v1.5 |
