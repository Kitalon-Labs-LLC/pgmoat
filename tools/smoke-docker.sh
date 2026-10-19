#!/usr/bin/env bash
set -euo pipefail

NET_NAME="pgmoat-smoke-net-$RANDOM"
DB_NAME="pgmoat-smoke-db-$RANDOM"

cleanup() {
  echo "Cleaning up smoke test containers and networks..."
  docker rm -f "$DB_NAME" 2>/dev/null || true
  docker network rm "$NET_NAME" 2>/dev/null || true
}
trap cleanup EXIT

echo "=== 1. Building Docker image pgmoat:dev ==="
docker build -f distribution/docker/Dockerfile -t pgmoat:dev .

echo "=== 2. Verifying non-root user ==="
UID_RUN=$(docker run --rm --entrypoint id pgmoat:dev -u)
if [ "$UID_RUN" = "0" ]; then
  echo "FAIL: Container runs as root (UID 0)"
  exit 1
fi
echo "PASS: Non-root user confirmed (UID: $UID_RUN)"

echo "=== 3. Testing --version and --help ==="
docker run --rm pgmoat:dev --version
docker run --rm pgmoat:dev --help > /dev/null

echo "=== 4. Testing against seed DB on shared network ==="
docker network create "$NET_NAME"
docker run -d --name "$DB_NAME" --network "$NET_NAME" -e POSTGRES_PASSWORD=postgres postgres:17-alpine

echo "Waiting for postgres to become ready..."
for i in {1..30}; do
  if docker exec "$DB_NAME" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec -i "$DB_NAME" psql -U postgres -d postgres < packages/core/test/integration/harness/seed.sql
docker exec -i "$DB_NAME" psql -U postgres -d postgres < packages/core/test/integration/harness/roles.sql

echo "Running MCP stdio client against pgmoat container..."
RESPONSE=$(node -e '
const { spawn } = require("child_process");
const net = process.argv[1];
const db = process.argv[2];

const child = spawn("docker", [
  "run", "--rm", "-i",
  "--network", net,
  "-e", `PGMOAT_DATABASE_URL=postgres://pgmoat_reader:pgmoat_reader_pw@${db}:5432/postgres`,
  "pgmoat:dev", "start", "--url-env", "PGMOAT_DATABASE_URL"
], { stdio: ["pipe", "pipe", "inherit"] });

let stdout = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
  if (stdout.includes("tools")) {
    child.kill();
  }
});

const initReq = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke-client", version: "1.0.0" }
  }
}) + "\n";

const listReq = JSON.stringify({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/list",
  params: {}
}) + "\n";

child.stdin.write(initReq);
setTimeout(() => {
  child.stdin.write(listReq);
}, 500);

child.on("close", () => {
  console.log(stdout);
});
' "$NET_NAME" "$DB_NAME")

echo "Client response received:"
echo "$RESPONSE"

for tool in "query" "describe_table" "list_tables" "explain" "sample_table"; do
  if ! echo "$RESPONSE" | grep -q "$tool"; then
    echo "FAIL: Expected tool $tool not found in tools/list response"
    exit 1
  fi
done

echo "PASS: All 5 tools listed successfully via Docker container!"

echo "=== 5. Docker image size report ==="
docker images pgmoat:dev --format "Image: {{.Repository}}:{{.Tag}}  Size: {{.Size}}"

echo "=== Docker smoke test complete: PASS ==="

