#!/usr/bin/env bash
set -euo pipefail

STAGE_DIR="dist-mcpb/stage"
OUT_DIR="dist-mcpb"
VERSION=$(node -e "const pkg=require('./packages/cli/package.json'); console.log(pkg.version);")
BUNDLE_FILE="$OUT_DIR/pgmoat-$VERSION.mcpb"

echo "=== 1. Building CLI bundle ==="
pnpm build

echo "=== 2. Preparing staging directory ==="
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/dist" "$OUT_DIR"

# Copy CLI bundle
cp packages/cli/dist/bin.mjs "$STAGE_DIR/dist/bin.mjs"

# Write staging package.json with the 3 production runtime dependencies
cat << 'EOF' > "$STAGE_DIR/package.json"
{
  "name": "pgmoat",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "libpg-query": "^18.1.5",
    "pg": "^8.23.1",
    "pg-cursor": "^2.22.1"
  }
}
EOF

# Copy manifest and icon
cp distribution/mcpb/manifest.json "$STAGE_DIR/manifest.json"
cp distribution/mcpb/icon.png "$STAGE_DIR/icon.png"

# Install production dependencies inside staging folder
echo "=== 3. Installing runtime dependencies in staging folder ==="
if ! (cd "$STAGE_DIR" && npm install --prefer-offline --omit=dev --no-audit --no-fund 2>/dev/null); then
  echo "Offline fallback: copying runtime modules from packages/cli/node_modules"
  mkdir -p "$STAGE_DIR/node_modules"
  cp -rL packages/cli/node_modules/* "$STAGE_DIR/node_modules/" 2>/dev/null || true
fi

echo "=== 4. Packaging MCPB bundle ==="
cd "$STAGE_DIR"
rm -f "../../$BUNDLE_FILE"
if command -v zip >/dev/null 2>&1; then
  zip -q -r "../../$BUNDLE_FILE" .
else
  python3 -m zipfile -c "../../$BUNDLE_FILE" .
fi
cd ../..

echo "=== 5. Signing check ==="
if [ -n "${MCPB_SIGNING_KEY:-}" ]; then
  echo "Signing bundle with MCPB_SIGNING_KEY..."
  # When mcpb CLI is available with signing key
  npx --yes @anthropic-ai/mcpb sign "$BUNDLE_FILE" --key "$MCPB_SIGNING_KEY" || echo "Signing warning: key sign skipped"
else
  echo "WARNING: No MCPB_SIGNING_KEY configured. Produced unsigned bundle."
fi

SIZE=$(du -h "$BUNDLE_FILE" | cut -f1)
echo "=== Successfully built $BUNDLE_FILE ($SIZE) ==="

