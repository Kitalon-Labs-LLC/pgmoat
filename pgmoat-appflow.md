# Appflow: pgmoat

Doc owner: Sowad Al-Mughni (Kitalon Labs)
Status: Draft v2 (supersedes pgbridge Appflow v1)
Last updated: 2026-10-17
Companion docs: 01 PRD, 02 Feature Spec, 03 Technical Architecture, 06 UI/UX Design

End-to-end flows for pgmoat: human journeys, request flows inside the server, and deployment topologies. Diagrams are Mermaid (render on GitHub). Each flow names the features (F#) and requirements (R#) it exercises.

---

## 1) Journey: first install in Claude Desktop (MCPB)

```mermaid
flowchart TD
    A([Developer downloads pgmoat.mcpb]) --> B[Double-click: Claude Desktop install dialog]
    B --> C[Enter Postgres URL - stored as a secret]
    C --> D[Install]
    D --> E[Claude Desktop starts pgmoat via bundled Node]
    E --> F{Config file provided?}
    F -- No --> G[Zero-config: read-only defaults, all public tables]
    F -- Yes --> H[Load pgmoat.yaml]
    G --> I[Introspect schema + doctor in warn mode]
    H --> J[Introspect schema + doctor in enforce mode]
    J -- fail findings --> K[Refuse to start; error visible in Claude Desktop logs]
    J -- ok --> L[Register 5 tools]
    I --> L
    L --> M[User asks a question]
    M --> N[Claude: list_tables -> describe_table -> query]
    N --> O[Answer shown; audit entry written locally]
```

Target: under 3 minutes, no terminal. Features: F1, F4, F7, F11, F14, F19. Requirements: R1, R9, R23.

---

## 2) Journey: Claude Code or another client (npx)

```mermaid
flowchart LR
    A[claude mcp add pgmoat -- npx -y pgmoat URL] --> B[pgmoat zero-config start]
    B --> C[stderr notice: mode, budgets, audit path, doctor summary]
    C --> D[Agent queries]
    D --> E{Want annotations, hidden columns, RLS?}
    E -- Later --> D
    E -- Yes --> F[npx pgmoat init]
    F --> G[Edit pgmoat.yaml descriptions]
    G --> H[pgmoat doctor -> apply REVOKE suggestions]
    H --> I[Switch client config to: pgmoat start --config pgmoat.yaml]
    I --> D
```

---

## 3) Journey: migrating from the archived reference server

```mermaid
flowchart TD
    A([Team uses @modelcontextprotocol/server-postgres]) --> B[Reads migration guide or Datadog advisory]
    B --> C[Replace package name with pgmoat in client config]
    C --> D[Restart client]
    D --> E[Existing prompts calling query with sql keep working]
    E --> F{Agent sends unsafe SQL?}
    F -- COMMIT; DROP ... --> G[PGM-204 refused; nothing reaches Postgres]
    F -- UPDATE ... --> H[PGM-201 refused]
    F -- SELECT * FROM huge --> I[200 rows + PGM-301 warning]
    F -- normal SELECT --> J[Result with untrusted-data framing]
```

Requirement: R23. The migration guide also lists behavior differences: row cap, catalog refusal, structured output.

---

## 4) Journey: security review

```mermaid
flowchart TD
    S([Security engineer assigned]) --> A[Read SECURITY.md and /docs/safety]
    A --> B[Run pgmoat test-corpus on a scratch DB]
    B --> C{318/318 pass?}
    C -- No --> X[Block: report issue]
    C -- Yes --> D[Review team pgmoat.yaml]
    D --> E{mode read-only?}
    E -- No --> E2[Check v1.1 write allow-lists and confirm: always]
    E -- Yes --> F{Sensitive columns hidden?}
    E2 --> F
    F -- No --> X2[Block: hide secrets, PII as required]
    F -- Yes --> G{Multi-tenant?}
    G -- Yes --> H{rls.required true and token.* sources?}
    H -- No --> X3[Block: tenant must come from verified identity]
    H -- Yes --> I[Run pgmoat doctor --strict]
    G -- No --> I
    I --> J{0 failures, 0 warnings?}
    J -- No --> X4[Block: apply REVOKE / NOBYPASSRLS / FORCE RLS fixes]
    J -- Yes --> K{Audit durable? file+rotation or postgres}
    K -- No --> X5[Block: stderr only is not evidence]
    K -- Yes --> L[Run pgmoat audit verify on staging logs]
    L --> M([Approve with recorded conditions])
```

### 4.1 Review checklist

| Item | Pass when |
|---|---|
| Mode | `read-only` (v1.0) |
| Hidden columns | Every secret and regulated field is `hidden: true` |
| Role | `pgmoat doctor --strict` exits 0 |
| RLS | `required: true` with `token.*` (HTTP) or `env.*`/`static:` (single tenant) sources; protected tables listed |
| Catalog access | `allow_catalog_queries: false` |
| Budgets | Defaults or tighter |
| Transport | stdio, or HTTP with OAuth and allowed hosts |
| Audit | File with retention or Postgres with append-only role; `verify` passes |
| Redaction | `redact_fields` covers org-specific secret names |
| Agent tool mix | No outbound-capable tools combined with sensitive data in the same agent, or a documented exception |
| Corpus | 100% on the team's Postgres version |

---

## 5) Journey: auditor request

```mermaid
flowchart LR
    Q[Auditor: all agent queries for tenant X in Q4] --> E[Engineer]
    E --> D{Audit destination}
    D -- file --> F[pgmoat audit query --tenant X --since --until --format csv]
    D -- postgres --> P[SQL on pgmoat.audit filtered by rls_context]
    F --> V[pgmoat audit verify --path ...]
    P --> V2[pgmoat audit verify --postgres --since --until]
    V --> R[Deliver CSV + verification report]
    V2 --> R
```

---

## 6) Request flow: `query` over stdio

```mermaid
sequenceDiagram
    autonumber
    participant C as MCP client
    participant S as SDK v2 (serveStdio)
    participant T as run-tool
    participant R as rls/resolve
    participant P as safety pipeline
    participant X as postgres/execute
    participant DB as Postgres
    participant A as audit

    C->>S: tools/call query {sql} (_meta envelope)
    S->>T: handler(args, ctx)
    T->>T: RequestContext (request_id, client, principal=local, trace)
    T->>R: resolve session variables (env/static/trusted meta)
    alt required value missing
        R-->>T: PGM-401/403/404
        T->>A: emit refused
        T-->>C: isError result
    end
    T->>P: parse -> classify -> policy -> rewrite -> re-check
    alt refused
        P-->>T: PGM-2xx / PGM-302
        T->>A: emit refused
        T-->>C: isError result
    end
    T->>X: executeRead(sql, rls, budgets, signal)
    X->>DB: BEGIN READ ONLY
    X->>DB: set_config statement_timeout, lock_timeout, idle timeout (local)
    X->>DB: set_config RLS variables (local, bound params)
    X->>DB: Parse/Bind/Execute via cursor, read max_rows+1
    alt timeout / error
        DB-->>X: 57014 / error
        X->>DB: ROLLBACK; destroy connection
        X-->>T: PGM-303 / sanitized error
        T->>A: emit error
        T-->>C: isError result
    end
    X->>DB: COMMIT
    X-->>T: rows, fields
    T->>T: budgets (rows, columns, cells, payload) + output (structured + framed text)
    T->>A: emit success (redact, chain, enqueue)
    T-->>C: result (structuredContent + text)
```

---

## 7) Request flow: safety pipeline decisions

```mermaid
flowchart TD
    A([sql]) --> L0{length <= max_sql_chars?}
    L0 -- no --> R206[PGM-206]
    L0 -- yes --> P[libpg-query parse]
    P -- error/empty --> R206
    P --> M{exactly 1 statement?}
    M -- no --> R204[PGM-204]
    M -- yes --> T{top-level Select/Explain/Show?}
    T -- no --> R201[PGM-201]
    T -- yes --> EA{EXPLAIN with ANALYZE?}
    EA -- yes --> R209[PGM-209]
    EA -- no --> W[walk all nodes with scopes]
    W --> F1{forbidden or unknown node?}
    F1 -- yes, in CTE --> R203[PGM-203]
    F1 -- yes --> R201
    F1 -- no --> F2{INTO or locking clause?}
    F2 -- yes --> R202[PGM-202]
    F2 -- no --> F3{function not allowed?}
    F3 -- yes --> R205[PGM-205]
    F3 -- no --> PO{relation hidden / unknown / catalog / unexposed schema?}
    PO -- yes --> R207[PGM-207]
    PO -- no --> CO{hidden column, whole-row, or star over hidden?}
    CO -- yes --> R208[PGM-208]
    CO -- no --> LI{constant LIMIT > max_rows?}
    LI -- yes --> R302[PGM-302]
    LI -- no --> RW[inject LIMIT max_rows+1 if absent; deparse]
    RW --> RC{re-parse + re-classify same outcome?}
    RC -- no --> R210[PGM-210]
    RC -- yes --> OK([allowed sql])
```

Refusal latency target: under 3 ms p95 (no database contact).

---

## 8) Request flow: HTTP with OAuth

```mermaid
sequenceDiagram
    autonumber
    participant U as End user
    participant H as Agent host (MCP client)
    participant IdP as Identity provider
    participant G as pgmoat (HTTP)
    participant DB as Postgres

    H->>G: POST /mcp (no token)
    G-->>H: 401 WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource", scope="pgmoat:read"
    H->>G: GET /.well-known/oauth-protected-resource
    G-->>H: { resource, authorization_servers:[IdP], scopes_supported }
    H->>IdP: OAuth 2.1 + PKCE, resource=<pgmoat URL>
    U->>IdP: sign in, consent
    IdP-->>H: access token (aud=pgmoat URL, tenant_id claim)
    H->>G: POST /mcp tools/call query, Authorization: Bearer ...
    G->>G: verify JWT (JWKS, iss, aud, exp, scope) -> Principal
    G->>G: RLS: app.tenant_id <- token.tenant_id
    G->>DB: BEGIN READ ONLY; set_config(...); cursor query; COMMIT
    G-->>H: result
    H-->>U: answer
```

Failure paths: wrong audience or expired token gives 401 (PGM-601); missing scope gives 403 `insufficient_scope` (PGM-602); token without `tenant_id` and `required: true` gives a tool error PGM-405 (HTTP 200 with `isError`, because auth succeeded but context is incomplete).

---

## 9) Audit pipeline

```mermaid
flowchart LR
    subgraph Request path
      T[tool handler finally-block] --> B[build entry]
      B --> RD[redact keys, SQL literals, patterns]
      RD --> CH[chain: seq, prev_hash, entry_hash]
      CH --> Q{buffer has room?}
      Q -- yes --> EN[enqueue]
      Q -- no --> DR[drop + count + CRITICAL stderr]
    end
    subgraph Flush loop every 100 ms
      EN --> BA[batch]
      BA --> D1[file]
      BA --> D2[stderr]
      BA --> D3[postgres - separate pool]
      D3 -- failure --> RT[retry with backoff, keep in buffer]
    end
```

| Buffer state | Behavior |
|---|---|
| Under 80% | Normal |
| 80% to 100% | Warning to stderr once per minute |
| Full | Drop new entries, increment counter, CRITICAL once per minute; next written entry carries `dropped_since_last` |
| Destination recovers | Backlog flushes in order |

---

## 10) Deployment: local sidecar (default)

```mermaid
flowchart LR
    subgraph Laptop
      CL[Claude Desktop / Claude Code / Cursor] <-->|stdio| PM[pgmoat]
      PM --> AF[(audit files)]
    end
    PM -->|TLS| DB[(Postgres: local, staging, or replica)]
```

---

## 11) Deployment: production agent sidecar

```mermaid
flowchart LR
    subgraph Pod
      AG[Agent service] <-->|stdio| PM[pgmoat]
    end
    PM -->|role pgmoat_reader| DB[(App Postgres with RLS)]
    PM -->|role pgmoat_audit| AU[(Audit Postgres)]
    AU --> SIEM[SIEM]
```

RLS source: `env.TENANT_ID` (one tenant per pod) or `meta.*` with `trust_request_meta: true` (the agent service sets the tenant per request and is the trust boundary).

---

## 12) Deployment: multi-tenant gateway

```mermaid
flowchart TD
    U1[Tenant A user] --> H[Agent host]
    U2[Tenant B user] --> H
    H -->|Bearer token per user| LB[TLS load balancer]
    LB --> G1[pgmoat replica 1]
    LB --> G2[pgmoat replica 2]
    G1 -->|set_config app.tenant_id from token| DB[(Postgres + RLS + FORCE)]
    G2 --> DB
    G1 --> AU[(Audit DB)]
    G2 --> AU
```

pgmoat is stateless, so replicas scale horizontally behind any load balancer without session affinity (the 2026-07-28 protocol has no sessions).

Alternative for strict isolation: one pgmoat per tenant with `static:` RLS values or a per-tenant database role.

---

## 13) Failure and recovery

```mermaid
flowchart TD
    C([pgmoat crashes]) --> S{Supervisor? systemd / docker / client restart}
    S -- yes --> R[Restart: new instance_id, new chain]
    S -- no --> M[Operator restarts]
    R --> I[Introspect schema, doctor, ready]
    M --> I
    I --> N[Lost: at most 100 ms of unflushed audit; in-flight queries rolled back by Postgres]

    PG([Postgres unreachable]) --> E1[Requests: PGM-504 / PGM-503]
    PG --> B1[Pool reconnect with backoff, cap 30 s]
    B1 --> OK1[Recovered: next request succeeds]

    AD([Audit destination down]) --> Q1[Buffer up to 10 MB]
    Q1 --> F1{Full?}
    F1 -- no --> W1[Wait and retry]
    F1 -- yes --> D1[Drop with recorded counter + CRITICAL]
    W1 --> OK2[Recovered: flush backlog]
```

| State | Loss on crash |
|---|---|
| Schema cache | Rebuilt at start (under 1 s for 100 relations) |
| Audit buffer | At most one flush interval (100 ms) |
| In-flight queries | Rolled back by Postgres; client sees an error |
| Audit chain | New chain per instance; `verify` handles many instances |

---

## 14) End-to-end example

```mermaid
flowchart TD
    Q[User: How many active users signed up this week?] --> C[Claude plans]
    C --> T1[list_tables]
    T1 --> A1[(audit: list_tables success)]
    T1 --> C
    C --> T2[describe_table public.users]
    T2 --> A2[(audit: describe_table success)]
    T2 --> C
    C --> T3["query: SELECT count(*) FROM users WHERE deleted_at IS NULL AND created_at >= date_trunc('week', now())"]
    T3 --> S[safety ok, LIMIT 201 injected]
    S --> X[BEGIN READ ONLY ... COMMIT, 1 row, 18 ms]
    X --> A3[(audit: query success, fingerprint 9f1c...)]
    X --> C
    C --> ANS[Answer: 312 active users signed up this week]
```

Three tool calls, three chained audit entries. An auditor can reconstruct exactly what the agent saw and did.

---

## 15) Identifiers

| ID | Scope | Created | Used in |
|---|---|---|---|
| `request_id` (ULID) | One tool call | `run-tool.ts` | Result `_meta`, audit, logs |
| `instance_id` (ULID) | One process start | `runtime.ts` | Audit chain grouping |
| `seq` | Per instance | Audit chain | Ordering and gap detection |
| `principal` | Per request | `auth.ts` (token `sub`) or `local` | Audit |
| `trace_id` | Per request (optional) | Client `traceparent` in `_meta` | Audit, OpenTelemetry (v1.1) |
| `client_name/version` | Per request (self-reported) | `_meta` envelope | Audit (display only) |
| `sql_fingerprint` | Per query shape | `fingerprint.ts` | Audit pattern analysis |

There is no session ID. The 2026-07-28 protocol has no sessions, and a stdio process is not a conversation.

---

## 16) Open issues

| ID | Question | Lean |
|---|---|---|
| AF-01 | Expose `/metrics` in v1.0 for the gateway pattern? | v1.1 |
| AF-02 | Optional pre-execution EXPLAIN gate for high estimated cost? | v1.2, opt-in |
| AF-03 | Return PGM-405 as a tool error (current) or HTTP 403? | Tool error: auth succeeded, context is incomplete |
