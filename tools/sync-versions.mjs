#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const versionArg = process.argv[2];
let targetVersion = versionArg;

if (!targetVersion) {
  const cliPkgPath = path.join(root, 'packages/cli/package.json');
  const cliPkg = JSON.parse(fs.readFileSync(cliPkgPath, 'utf-8'));
  targetVersion = cliPkg.version;
}

if (!targetVersion) {
  console.error('Error: No target version provided and could not read from packages/cli/package.json');
  process.exit(1);
}

// Strip leading 'v' if present
if (targetVersion.startsWith('v')) {
  targetVersion = targetVersion.slice(1);
}

console.log(`Syncing version: ${targetVersion}`);

// 1. distribution/registry/server.json
const serverJsonPath = path.join(root, 'distribution/registry/server.json');
if (fs.existsSync(serverJsonPath)) {
  const server = JSON.parse(fs.readFileSync(serverJsonPath, 'utf-8'));
  server.version = targetVersion;
  if (Array.isArray(server.packages) && server.packages[0]) {
    server.packages[0].version = targetVersion;
  }
  fs.writeFileSync(serverJsonPath, JSON.stringify(server, null, 2) + '\n');
  console.log('Updated distribution/registry/server.json');
}

// 2. distribution/mcpb/manifest.json
const manifestPath = path.join(root, 'distribution/mcpb/manifest.json');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  manifest.version = targetVersion;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('Updated distribution/mcpb/manifest.json');
}

// 3. packages/cli/package.json
const cliPkgPath = path.join(root, 'packages/cli/package.json');
if (fs.existsSync(cliPkgPath)) {
  const cliPkg = JSON.parse(fs.readFileSync(cliPkgPath, 'utf-8'));
  cliPkg.version = targetVersion;
  fs.writeFileSync(cliPkgPath, JSON.stringify(cliPkg, null, 2) + '\n');
  console.log('Updated packages/cli/package.json');
}

console.log('Version synchronization complete.');

