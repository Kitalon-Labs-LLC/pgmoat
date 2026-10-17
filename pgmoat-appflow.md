# Appflow: pgbridge
Doc owner: Sowad Al-Mughni
Status: Draft
Last updated: 2026-05-12
Companion docs: PRD (01), Feature Spec (02), Technical Architecture (03), TRD (04), Backend Schema (05), UI/UX Design (06)

This document maps end-to-end flows through pgbridge. Three classes of flow:

1. **User journeys**: what humans do, step by step (developer installing, security engineer reviewing, auditor exporting).
2. **Request flows**: what happens inside pgbridge when an agent invokes a tool.
3. **Operational flows**: deployment topologies, recovery, multi-tenant boundaries.

Diagrams use Mermaid so they render on GitHub and in most markdown viewers. Each flow ties back to numbered features in the Feature Spec and requirements in the TRD.

---

## 1) User journey: first install (developer)

Target time-to-first-query: under 10 minutes for someone who knows their schema.

```mermaid
flowchart TD
    Start([Developer opens terminal]) --> Run[Run: npx pgbridge init]
    Run --> Prompt1{Postgres URL?}
    Prompt1 --> Connect{Can connect?}
    Connect -- No --> Err101[Show PGB-101 with pg_isready hint] --> Run
    Connect -- Yes --> Introspect[Introspect schema]
    Introspect --> PromptsRest[Prompt for: server name, description, mode, audit dest, sampling]
    PromptsRest --> Write[Write pgbridge.yaml + update .gitignore]
    Write --> PrintBlock[Print Claude Desktop config block]
    PrintBlock --> Edit[Developer edits pgbridge.yaml descriptions]
    Edit --> Paste[Paste config into claude_desktop_config.json]
    Paste --> Restart[Restart Claude Desktop]
    Restart --> FirstAsk[Ask Claude: 'How many active users?']
    FirstAsk --> AgentCalls[Agent calls list_tables, describe_table, query]
    AgentCalls --> Response[Result returned in chat]
    Response --> AuditWritten[Audit entry written to ./pgbridge-audit.log]
    AuditWritten --> Done([Done: agent has safe DB access])
```

### Decision points and time budget

| Step | Time | Failure mode | Recovery |
|---|---|---|---|
| `pgbridge init` invocation | 2s | None | - |
| Postgres connection | 1-3s | PGB-101 | Show `pg_isready` hint |
| Schema introspection | 1-10s (size-dependent) | Slow query | Warn at 5s, continue |
| Wizard prompts (6 questions) | 60-90s | Bad input | Re-prompt with hint |
| YAML write | <1s | Permission denied | Suggest `--out` flag |
| Manual annotation pass | 5-25min (developer's choice) | Skipped | Agent sees TODOs |
| Claude Desktop config paste | 30s | Bad path | Validate path on next start |
| First agent query | 10-30s | Tool not registered | Verify config block syntax |

Total minimum: ~5 minutes (skip annotations).
Recommended: 10-15 minutes (light annotation pass).

---

## 2) User journey: daily developer work

The developer iterates on schema and annotations while the agent runs.

```mermaid
flowchart LR
    Edit[Edit pgbridge.yaml] --> Save[Save file]
    Save --> Watch{--watch mode?}
    Watch -- Yes --> Reload[pgbridge reloads schema cache]
    Reload --> Valid{Valid YAML?}
    Valid -- Yes --> Done1[Agent sees new annotations]
    Valid -- No --> KeepOld[Keep previous config, log error] --> FixEdit[Developer sees error]
    FixEdit --> Edit
    Watch -- No --> Restart[Restart pgbridge process]
    Restart --> Reload
```

Validate-before-restart is a power user move:

```mermaid
flowchart LR
    Edit2[Edit pgbridge.yaml] --> Validate[Run: pgbridge validate]
    Validate --> Result{Valid?}
    Result -- Yes --> Restart2[pgbridge start applies changes]
    Result -- No --> ShowErr[Line/column error with field path]
    ShowErr --> Edit2
```

---

## 3) User journey: security review

The security engineer is gating production deployment. They never run pgbridge themselves; they read.

```mermaid
flowchart TD
    Start([Security engineer assigned to review]) --> ReadSec[Read SECURITY.md]
    ReadSec --> ReadSafety[Read /docs/safety + threat model]
    ReadSafety --> ReadConfig[Read team's pgbridge.yaml]
    ReadConfig --> Q1{Mode = read-only?}
    Q1 -- No --> CheckWrites[Verify scoped-write allow-lists are minimal]
    Q1 -- Yes --> Q2{Sensitive cols hidden?}
    CheckWrites --> Q2
    Q2 -- Yes --> Q3{RLS configured?}
    Q2 -- No --> Block1[Block: require hidden:true on password_hash etc.]
    Q3 -- Yes --> Q4{rls.required = true?}
    Q3 -- No --> Note1[Note: single-tenant deployment]
    Q4 -- Yes --> Q5{Budgets reasonable?}
    Q4 -- No --> Block2[Block: required=false defeats RLS]
    Q5 -- Yes --> Q6{Audit dest durable?}
    Q5 -- No --> Adjust[Tune budgets]
    Q6 -- Yes --> Q7{Postgres role least-privilege?}
    Q6 -- No --> Block3[Block: stdout is not durable for compliance]
    Q7 -- Yes --> Approve([Approve for production])
    Q7 -- No --> Block4[Block: rotate to dedicated read role]
    Note1 --> Q5
```

### Review checklist (artifact for the engineer)

| Item | Pass criterion |
|---|---|
| Mode | read-only OR scoped-write with explicit per-table allow-list |
| Sensitive columns | All PII/secrets marked `hidden: true` or `sensitive: high` |
| RLS | `rls.required: true` for multi-tenant; `session_variables` named |
| Budgets | `max_rows`, `max_query_ms`, `max_columns`, `max_payload_bytes` all set |
| Audit destination | file (with rotation), postgres, or s3 (not stdout for prod) |
| Audit redaction | `redact_fields` covers org-specific PII tokens |
| Postgres role | Dedicated read role; no superuser; only-needed grants |
| Network exposure | pgbridge runs as sidecar or behind agent host, not internet-exposed |
| Dependency review | npm audit clean; license check pass |
| SECURITY.md acknowledged | Engineer reads disclosure process |

---

## 4) User journey: auditor compliance query

A SOC 2 auditor asks: "Show me every query the AI agent ran on tenant tnt_abc in March 2026."

```mermaid
flowchart LR
    Ask[Auditor asks question] --> Engineer[Engineer translates to filter]
    Engineer --> Choose{Audit dest?}
    Choose -- File --> CLI1[pgbridge audit query --tenant tnt_abc --since 2026-03-01 --until 2026-04-01]
    Choose -- Postgres --> SQL[SELECT * FROM pgbridge.audit WHERE rls_context->>'tenant_id' = $1 AND created_at >= $2 AND created_at < $3]
    Choose -- S3 --> S3Query[Download daily NDJSON files; jq filter]
    CLI1 --> Export[Export CSV]
    SQL --> Export
    S3Query --> Export
    Export --> Deliver[Deliver to auditor]
```

A well-configured pgbridge produces an export in under 5 minutes regardless of destination.

---

## 5) Request flow: a single `query` tool call

This is the canonical request lifecycle, expanded from Tech Arch §3.

```mermaid
sequenceDiagram
    participant Agent as MCP Client (Claude Desktop)
    participant Server as pgbridge Server
    participant Parser as SQL Parser (pg-query-emscripten)
    participant Budget as Budgets
    participant Pool as Postgres Pool
    participant PG as Postgres
    participant Audit as Audit Pipeline

    Agent->>Server: tools/call query(sql, _meta.rls_context)
    Server->>Server: Generate request_id (ULID)
    Server->>Server: Start audit context
    Server->>Parser: parseQuery(sql)
    Parser-->>Server: AST
    Server->>Server: Classify AST (allowed?)
    alt Refused
        Server->>Audit: Emit (status=refused, code=PGB-2XX)
        Server-->>Agent: isError=true, _meta.error_code
    else Allowed
        Server->>Budget: Inject auto-LIMIT if needed
        Server->>Pool: acquire connection
        Pool-->>Server: client
        Server->>PG: BEGIN
        Server->>PG: SET LOCAL statement_timeout = max_query_ms
        Server->>PG: set_config('app.current_tenant_id', $tenant, true)
        Server->>PG: execute SQL
        alt Postgres errors or times out
            PG-->>Server: error
            Server->>PG: ROLLBACK
            Server->>Pool: release
            Server->>Audit: Emit (status=error)
            Server-->>Agent: isError=true with error detail
        else Success
            PG-->>Server: rows
            Server->>PG: COMMIT
            Server->>Pool: release
            Server->>Budget: Truncate columns + check payload
            Server->>Server: Format Markdown table
            Server->>Audit: Emit (status=success) async
            Server-->>Agent: response with rows + _meta
        end
    end
```

### Step-by-step with TRD links

| Step | TRD requirements engaged |
|---|---|
| Request received via stdio | IR-MCP-01, FR-PROTO-01 |
| request_id generated | IR-AUDIT-03 |
| SQL parsed via WASM parser | SEC-INJECT-01, FR-READ-08 |
| AST classified | FR-READ-01 through FR-READ-06 |
| Auto-LIMIT injected | FR-BUDGET-01 |
| BEGIN, SET LOCAL, query, COMMIT | FR-RLS-01, FR-RLS-05, SEC-INJECT-02, SEC-ESCAPE-01 |
| Statement timeout | FR-BUDGET-03 |
| Column truncation | FR-BUDGET-05 |
| Payload check | FR-BUDGET-06 |
| Audit emit | FR-AUDIT-01, FR-AUDIT-03 |
| Response shape | IR-MCP-03, IR-MCP-04 |

---

## 6) Request flow: refusal paths

Every refusal short-circuits before Postgres is touched. The refusal flow itself must be cheap (sub-millisecond budget excluding parse).

```mermaid
flowchart TD
    Start([tools/call query]) --> Parse[Parse SQL]
    Parse --> Mult{Multiple statements?}
    Mult -- Yes --> R204[PGB-204]
    Mult -- No --> Top{Top-level node allowed?}
    Top -- No --> R201[PGB-201]
    Top -- Yes --> Variant{SELECT INTO / FOR UPDATE?}
    Variant -- Yes --> R202[PGB-202]
    Variant -- No --> CTE{Writing CTE?}
    CTE -- Yes --> R203[PGB-203]
    CTE -- No --> Func{Forbidden function?}
    Func -- Yes --> R205[PGB-205]
    Func -- No --> Limit{Explicit LIMIT > max_rows?}
    Limit -- Yes --> R301a[PGB-301a]
    Limit -- No --> Rls{RLS required but missing?}
    Rls -- Yes --> R401[PGB-401]
    Rls -- No --> Proceed[Proceed to execution]
    R204 --> Audit[Audit + response]
    R201 --> Audit
    R202 --> Audit
    R203 --> Audit
    R205 --> Audit
    R301a --> Audit
    R401 --> Audit
```

### Latency budget for refusals

| Path | Target p95 |
|---|---|
| Refused on parse error | <1ms |
| Refused on AST classification | <5ms |
| Refused on RLS missing | <2ms (no parse needed) |
| Refused on budget (LIMIT > max) | <5ms (parse + check) |

---

## 7) Request flow: schema discovery (`describe_table`)

Schema discovery is cache-hot most of the time. Cold path runs on startup.

```mermaid
sequenceDiagram
    participant Agent
    participant Server
    participant Cache as Schema Cache (in-memory)
    participant PG as Postgres
    participant Audit

    Agent->>Server: describe_table(table='public.users')
    Server->>Cache: lookup('public.users')
    alt Cache hit
        Cache-->>Server: TableInfo
    else Cache cold or stale
        Server->>PG: SELECT FROM information_schema.columns + pg_catalog
        PG-->>Server: rows
        Server->>Cache: store
        Cache-->>Server: TableInfo
    end
    Server->>Server: Filter hidden columns
    Server->>Server: Merge yaml annotations
    Server->>Server: Render Markdown
    Server->>Audit: Emit (tool=describe_table, success)
    Server-->>Agent: response
```

### Cache invariants

| Invariant | How enforced |
|---|---|
| Hidden tables never exit the cache layer | Filtered at cache build time, not at render time |
| Hidden columns never exit the cache layer | Same |
| TTL 60s default | Background refresh task |
| Manual reload via --watch | YAML file mtime triggers rebuild |
| Stale yaml (table missing from DB) | Logged warning, served from cache with "no longer exists" indicator |

---

## 8) Audit pipeline flow

Audit is the cross-cutting concern. Every tool call hits it. The pipeline must never block the request path.

```mermaid
flowchart LR
    subgraph Request path
      Tool[Tool handler] --> Emit[audit.emit redacted entry]
      Emit --> Done[Return to caller]
    end

    subgraph Async (separate task)
      Queue[(In-memory queue<br/>10MB max)] --> Loop[Flush loop<br/>every 100ms]
      Loop --> Batch[Batch entries]
      Batch --> Stdout[stdout destination]
      Batch --> File[file destination]
      Batch --> PGAudit[postgres destination]
      Batch --> DD[datadog destination]
      Batch --> S3[s3 destination]
    end

    Emit -.enqueue.-> Queue

    Queue -. queue full .-> Alarm[stderr CRITICAL alarm<br/>entry dropped]
```

### Backpressure behavior

| Condition | Behavior |
|---|---|
| Queue under 50% full | Normal operation |
| Queue 50-80% full | Continue; metrics indicator turns yellow |
| Queue 80-100% full | Continue; warning logged once per 60s |
| Queue full + new entry | Drop entry; stderr CRITICAL alarm; never block caller |
| Destination unreachable for N retries | Mark destination unhealthy; continue trying with exponential backoff (cap 30s) |
| Destination becomes healthy | Resume normal flushing |

### Why fire-and-forget

The blocking alternative (block the query if audit cannot write) trades availability for completeness. For an MCP server sitting in front of a production database, availability matters more. Operators who require completeness either (a) use a durable destination with high uptime (Postgres on the same DB; S3; Datadog) or (b) monitor the CRITICAL alarm and stop the agent if audit cannot keep up.

---

## 9) Deployment flow: sidecar pattern (default)

```mermaid
flowchart LR
    subgraph Developer machine
      ClaudeDesktop[Claude Desktop]
      Pgbridge[pgbridge process]
      ClaudeDesktop <-->|stdio| Pgbridge
      Pgbridge -->|TCP/TLS| RemoteDB[(Postgres)]
      Pgbridge --> LocalLog[/audit log on disk/]
    end
    RemoteDB -.-> ProdAudit[(audit destination<br/>e.g. central Postgres)]
```

Used by: local development, internal tools, single-developer agent.

---

## 10) Deployment flow: production agent host

```mermaid
flowchart LR
    subgraph Production
      Agent[Agent service container]
      Pgbridge[pgbridge container<br/>sidecar in same pod]
      Agent <-->|stdio| Pgbridge
      Pgbridge -->|VPC TLS| PG[(Postgres)]
      Pgbridge --> Audit[(Audit table<br/>same DB or separate)]
      Audit --> SIEM[SIEM / Datadog]
    end
```

Notes:

- pgbridge runs as a sidecar in the same pod for stdio communication.
- Postgres role for pgbridge is read-only on user tables, INSERT-only on audit.
- A separate Postgres role is used by the audit destination, so a compromise of the query role cannot rewrite audit.

---

## 11) Deployment flow: multi-tenant SaaS

Two architectures, each with tradeoffs.

### A) One pgbridge instance per tenant

```mermaid
flowchart TD
    Tenant1[Tenant A request] --> PG1[pgbridge instance A]
    Tenant2[Tenant B request] --> PG2[pgbridge instance B]
    Tenant3[Tenant C request] --> PG3[pgbridge instance C]
    PG1 --> DB[(Shared Postgres)]
    PG2 --> DB
    PG3 --> DB
```

Pros: strongest isolation. Each tenant gets a process. Hostile-tenant blast radius is one process.
Cons: process-per-tenant capex; idle processes consume RAM.
Best for: enterprise plans, high-isolation requirements.

### B) Single pgbridge with per-request RLS context

```mermaid
flowchart TD
    Tenant1[Tenant A request<br/>_meta.rls_context.tenant_id=A] --> PG[pgbridge instance]
    Tenant2[Tenant B request<br/>_meta.rls_context.tenant_id=B] --> PG
    Tenant3[Tenant C request<br/>_meta.rls_context.tenant_id=C] --> PG
    PG -->|"SET LOCAL app.current_tenant_id<br/>per transaction"| DB[(Postgres with RLS policies)]
```

Pros: cheap; one process serves many tenants.
Cons: process compromise affects all tenants; depends on RLS correctness end-to-end.
Best for: free/starter tiers, low-isolation workloads, RLS-validated databases.

The product supports both. v1 ships pattern A as the documented default (safer); pattern B is documented as an advanced option with a `--multi-tenant` flag that requires `rls.required: true`.

---

## 12) Disaster recovery and failure flows

```mermaid
flowchart TD
    Crash([pgbridge process crashes]) --> SD{Started via systemd / docker / supervisor?}
    SD -- Yes --> AutoRestart[Process restarted]
    SD -- No --> Manual[Operator restarts]
    AutoRestart --> Reconnect[Pool reconnects to Postgres]
    Manual --> Reconnect
    Reconnect --> SchemaRebuild[Introspect schema fresh]
    SchemaRebuild --> Ready[Ready to serve]
    Ready --> Note1[Note: in-flight audit entries since last flush are lost.<br/>Mitigation: lower flush interval; use synchronous destinations for compliance workloads.]

    PGFail([Postgres temporarily unreachable]) --> PoolError[pg pool errors on next acquire]
    PoolError --> RetryClient[pgbridge returns PGB-504 to client]
    PoolError --> Backoff[Pool retries with exponential backoff, cap 30s]
    Backoff --> PGUp{Postgres back?}
    PGUp -- Yes --> Recover[Pool recovers; next request succeeds]
    PGUp -- No --> Keep[Keep retrying; alarm at 5min]

    AuditFail([Audit destination unreachable]) --> Queue[Entries buffer in queue]
    Queue --> QueueFull{Queue full?}
    QueueFull -- No --> DestUp{Destination back?}
    QueueFull -- Yes --> Drop[Drop new entries; CRITICAL alarm]
    DestUp -- Yes --> FlushAll[Flush backlog]
    DestUp -- No --> Queue
```

### What state is lost on crash

| State | Loss profile |
|---|---|
| Schema cache | Rebuilt on startup; cost: ~500ms for 100 tables |
| Audit queue (unflushed) | Lost (default 100ms flush window; ≤100ms of activity max) |
| In-flight queries | Postgres rolls back uncommitted transactions; client sees disconnect |
| Connection pool | Recreated; ~50ms cold start |
| Audit destinations | Reopened; file appended; Postgres reconnected |

---

## 13) End-to-end data flow

How a developer's question becomes a row in the audit table.

```mermaid
flowchart TD
    Dev[Developer asks Claude:<br/>'How many active users?'] --> Claude[Claude composes plan]
    Claude --> Tool1[Calls list_tables]
    Tool1 --> Pgbridge1[pgbridge returns annotated table list]
    Pgbridge1 --> Audit1[(audit row: tool=list_tables, status=success)]
    Pgbridge1 --> Claude
    Claude --> Tool2[Calls describe_table users]
    Tool2 --> Pgbridge2[pgbridge returns column-level schema]
    Pgbridge2 --> Audit2[(audit row: tool=describe_table)]
    Pgbridge2 --> Claude
    Claude --> Tool3[Calls query<br/>SELECT count(*) FROM users<br/>WHERE deleted_at IS NULL]
    Tool3 --> Parser[Parse SQL]
    Parser --> Classify{Allowed?}
    Classify -- Yes --> Exec[Execute with budgets + RLS]
    Exec --> Result[Result: 1 row, 1 column, 23ms]
    Result --> Audit3[(audit row: tool=query, rows=1, ms=23)]
    Result --> Claude
    Claude --> Display[Display: '847 active users']
    Display --> Dev
```

This one user prompt produces three audit rows. Each row is independently searchable and exportable. The auditor can reconstruct exactly what the agent saw, how it got there, and what it answered with.

---

## 14) v1.5 cloud user journey (sketch)

For forward planning only.

```mermaid
flowchart TD
    Start([Land on app.pgbridge.dev]) --> Sign[Sign in via WorkOS/Clerk]
    Sign --> NewServer[Click 'New server']
    NewServer --> Form[Form: name, region, plan]
    Form --> Provision[Provision: spin Fly.io machine, generate tunnel auth key]
    Provision --> Display[Display tunnel install command]
    Display --> InstallTunnel[Customer installs tunnel client in their VPC]
    InstallTunnel --> Connected[Tunnel handshake; server status: running]
    Connected --> Config[Edit config in Monaco editor]
    Config --> Save[Save and apply revision]
    Save --> ConfigApplied[New runtime container started; old drained]
    ConfigApplied --> CopyURL[Copy MCP URL]
    CopyURL --> AgentConfig[Paste into agent config]
    AgentConfig --> FirstRequest[First request flows]
    FirstRequest --> AuditUI[Audit appears live in UI search]
```

---

## 15) Trace identifiers

Every event in the system can be correlated through these IDs.

| ID | Scope | Created at | Used by |
|---|---|---|---|
| `request_id` (ULID) | One MCP tool call | When server.setRequestHandler receives the call | Audit log, error responses, agent logs |
| `session_id` (ULID) | One MCP session (from initialize to shutdown) | At MCP initialize handshake | Audit log; "walk a session" debugging |
| `trace_id` (W3C, optional) | OpenTelemetry distributed trace | When `--otel` flag set | Datadog, Tempo, Honeycomb |
| `tenant_id` (string) | Per-request from `_meta.rls_context` | By the MCP client/host | Audit log, RLS variable |
| `pgbridge_version` | Per-process | At binary build | Audit log |
| `server_name` | Per-config | From `server.name` in YAML | Audit log; identifies which pgbridge for multi-server deployments |

Audit log entries always include `request_id`, `session_id`, `tenant_id` (if present), `pgbridge_version`, `server_name`. Distributed-trace IDs (W3C `traceparent`) are included when OTEL is enabled.

---

## 16) Open issues

| ID | Question | Owner | Due |
|---|---|---|---|
| AF-01 | Multi-tenant pattern B (single process + per-request RLS): ship the `--multi-tenant` flag in v1 or v1.1? Current: v1.1; v1 documents pattern A only to keep the safety message clear. | Sowad | 2026-05-13 |
| AF-02 | Should the request flow include an optional pre-execution `EXPLAIN` gate when query estimated rows exceed a threshold? Adds a roundtrip; opt-in via `budgets.explain_before_execute: true`. | Sowad | 2026-05-20 |
| AF-03 | Should pgbridge expose a `tools/list` health-check tool the operator can invoke from a TUI? Helpful for SREs; out of MCP norm. Defer to v1.1. | Sowad | v1.1 |
| AF-04 | Cancel-mid-query: best-effort `pg_cancel_backend` or wait for statement_timeout? Current: best-effort cancel on disconnect; documented as best-effort. | Sowad | 2026-05-15 |
