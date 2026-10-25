#!/usr/bin/env node
// Generates the static pages that back URLs the pgmoat CLI prints:
//   /pgmoat/docs/                 -> /pgmoat/
//   /pgmoat/docs/errors/          -> /pgmoat/#errors
//   /pgmoat/docs/errors/PGM-xxx/  -> /pgmoat/#PGM-xxx   (one page per code)
//   /pgmoat/schema/pgmoat.v1.json    (editor schema for pgmoat.yaml)
// The site is static, so each URL is a small redirect page. Run after the
// error registry or config schema changes: node tools/gen-landing.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const landing = path.join(root, 'landing');
const BASE = '/pgmoat/';

function redirectPage(target, title) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} | pgmoat</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="https://kitalonlabs.com${target}">
<meta http-equiv="refresh" content="0; url=${target}">
<script>location.replace(${JSON.stringify(target)});</script>
</head>
<body>
<p>Moved to <a href="${target}">${title}</a>.</p>
</body>
</html>
`;
}

function write(rel, content) {
  const file = path.join(landing, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const registry = fs.readFileSync(path.join(root, 'packages/core/src/errors.generated.ts'), 'utf8');
const codes = [...new Set(registry.match(/(?<=code: ')PGM-\d{3}(?=')/g))].sort();
if (codes.length === 0) {
  console.error('No error codes found in errors.generated.ts');
  process.exit(1);
}

// Every code must have an entry on the page, or its redirect lands nowhere.
const page = fs.readFileSync(path.join(landing, 'index.html'), 'utf8');
const missing = codes.filter((c) => !page.includes(`id="${c}"`));
if (missing.length > 0) {
  console.error(`landing/index.html has no entry for: ${missing.join(', ')}`);
  process.exit(1);
}

fs.rmSync(path.join(landing, 'docs'), { recursive: true, force: true });
write('docs/index.html', redirectPage(BASE, 'pgmoat documentation'));
write('docs/errors/index.html', redirectPage(`${BASE}#errors`, 'pgmoat error codes'));
for (const code of codes) {
  write(`docs/errors/${code}/index.html`, redirectPage(`${BASE}#${code}`, code));
}

const schema = path.join(root, 'packages/docs/public/schema/pgmoat.v1.json');
write('schema/pgmoat.v1.json', fs.readFileSync(schema, 'utf8'));

console.log(`Wrote ${codes.length} error pages, docs redirects, and schema to landing/`);
