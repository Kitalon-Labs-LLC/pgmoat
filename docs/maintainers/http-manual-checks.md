# HTTP Transport Manual Verification Guide

This document describes how to manually verify `pgmoat` serving over stateless Streamable HTTP transport using the MCP Inspector and a local OAuth Authorization Server (Keycloak).

---

## 1. Loopback Verification with No Auth (`auth.mode: none`)

### Step 1: Start `pgmoat` with HTTP Transport

Create a minimal configuration `pgmoat.yaml`:

```yaml
version: 1
server:
  name: local-pgmoat
transport: http

http:
  host: 127.0.0.1
  port: 8787
  path: /mcp
  allowed_hosts:
    - 127.0.0.1
    - localhost

auth:
  mode: none

connection:
  url: postgresql://readonly_agent:secret@127.0.0.1:5432/app
  schemas:
    - public

mode: read-only
```

Start `pgmoat`:
```bash
npx pgmoat start --config ./pgmoat.yaml
```

Expected startup banner on stderr:
```
pgmoat 0.1.0-alpha.1  local-pgmoat  read-only
config     /path/to/pgmoat.yaml
transport  http  listening on 127.0.0.1:8787/mcp
auth       none
database   127.0.0.1:5432/app  Postgres 17  role readonly_agent
...
ready
```

### Step 2: Test Health and Readiness Endpoints

```bash
# Healthz check
curl -i http://127.0.0.1:8787/healthz
# HTTP/1.1 200 OK
# ok

# Readyz check
curl -i http://127.0.0.1:8787/readyz
# HTTP/1.1 200 OK
# ok
```

### Step 3: Run MCP Inspector

Launch the official Model Context Protocol Inspector:
```bash
npx @modelcontextprotocol/inspector
```

In the Inspector web UI:
- **Transport Type:** Streamable HTTP (or HTTP / SSE)
- **URL:** `http://127.0.0.1:8787/mcp`
- Click **Connect**.
- Verify that `describe_table`, `explain`, `list_tables`, `query`, and `sample_table` appear in the tools panel.
- Execute `query` with `SELECT 1 AS test` and observe the structured rows and framed Markdown text.

---

## 2. OAuth 2.0 Protected Resource Verification (Keycloak)

### Step 1: Launch Local Keycloak Container

Run Keycloak with a preconfigured admin account:

```bash
docker run -d --name pgmoat-keycloak \
  -p 8080:8080 \
  -e KEYCLOAK_ADMIN=admin \
  -e KEYCLOAK_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:26.0.0 \
  start-dev
```

### Step 2: Configure Keycloak Realm and Client

1. Open `http://localhost:8080/admin` and log in with `admin`/`admin`.
2. Create Realm: `acme`.
3. Create Client:
   - **Client ID:** `pgmoat-client`
   - **Client Authentication:** On (confidential)
   - **Service Accounts Roles:** Enabled (client credentials grant)
4. Under **Client Scopes**:
   - Create scope `pgmoat:read`.
   - Add `pgmoat:read` to `pgmoat-client` default scopes.
5. Under **Credentials**:
   - Copy the Client Secret.

### Step 3: Configure `pgmoat` with OAuth

Update `pgmoat.yaml`:

```yaml
version: 1
server:
  name: acme-secure-db
transport: http

http:
  host: 0.0.0.0
  port: 8787
  path: /mcp
  public_url: https://pgmoat.acme.internal/mcp
  allowed_hosts:
    - 127.0.0.1
    - localhost
    - pgmoat.acme.internal

auth:
  mode: oauth
  issuer: http://localhost:8080/realms/acme
  audience: https://pgmoat.acme.internal/mcp
  jwks_url: http://localhost:8080/realms/acme/protocol/openid-connect/certs
  required_scopes:
    - pgmoat:read

connection:
  url: postgresql://readonly_agent:secret@127.0.0.1:5432/app
  schemas:
    - public

mode: read-only
```

Start `pgmoat`:
```bash
npx pgmoat start --config ./pgmoat.yaml
```

### Step 4: Verify Protected Resource Metadata (PRM)

```bash
curl -i http://127.0.0.1:8787/.well-known/oauth-protected-resource
```

Expected response:
```json
{
  "resource": "https://pgmoat.acme.internal/mcp",
  "authorization_servers": [
    "http://localhost:8080/realms/acme"
  ],
  "scopes_supported": [
    "pgmoat:read"
  ],
  "bearer_methods_supported": [
    "header"
  ]
}
```

### Step 5: Verify 401 Challenge without Token

```bash
curl -i -X POST http://127.0.0.1:8787/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expected response:
```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://pgmoat.acme.internal/mcp/.well-known/oauth-protected-resource", scope="pgmoat:read"
Content-Type: application/json
```

### Step 6: Mint Token and Connect via MCP Inspector

Mint an access token:
```bash
ACCESS_TOKEN=$(curl -s -X POST http://localhost:8080/realms/acme/protocol/openid-connect/token \
  -d "grant_type=client_credentials" \
  -d "client_id=pgmoat-client" \
  -d "client_secret=<CLIENT_SECRET>" \
  -d "scope=pgmoat:read" | jq -r .access_token)
```

Connect MCP Inspector with Header:
- **URL:** `http://127.0.0.1:8787/mcp`
- **Headers:** `Authorization: Bearer <ACCESS_TOKEN>`
- Test tool listing and queries.

