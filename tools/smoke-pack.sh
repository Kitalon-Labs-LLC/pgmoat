#!/usr/bin/env bash
set -euo pipefail

echo "=== Building CLI bundle ==="
pnpm build

echo "=== Packaging CLI ==="
cd packages/cli
TARBALL=$(npm pack | tail -n 1)
cd ../..
TARBALL_PATH="packages/cli/$TARBALL"

if [ ! -f "$TARBALL_PATH" ]; then
  echo "Error: Tarball $TARBALL_PATH not found!"
  exit 1
fi

SIZE=$(du -h "$TARBALL_PATH" | cut -f1)
echo "Packed: $TARBALL_PATH ($SIZE)"

for NODE_TAG in "22-slim" "24-slim"; do
  echo "=== Testing on node:$NODE_TAG ==="
  docker run --rm -v "$PWD:/w" -w /w "node:$NODE_TAG" bash -c "
    set -euo pipefail
    npm install -g '$TARBALL_PATH'
    pgmoat --version
    pgmoat --help > /dev/null
    echo 'Node $NODE_TAG smoke test: PASS'
  "
done

echo "=== Smoke pack completed successfully ==="

