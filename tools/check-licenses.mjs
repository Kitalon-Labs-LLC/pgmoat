import { execSync } from 'node:child_process';

const ALLOWED_PROD_LICENSES = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Python-2.0',
]);

try {
  const raw = execSync('pnpm licenses list --json --prod', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const data = JSON.parse(raw.trim() || '{}');
  const violations = [];

  for (const [license, packages] of Object.entries(data)) {
    if (!ALLOWED_PROD_LICENSES.has(license)) {
      const parts = license.replace(/[()]/g, '').split(/\s+OR\s+|\s+AND\s+/);
      const anyAllowed = parts.some((p) => ALLOWED_PROD_LICENSES.has(p.trim()));
      if (!anyAllowed) {
        violations.push({ license, packages });
      }
    }
  }

  if (violations.length > 0) {
    console.error('Disallowed production licenses found:');
    for (const v of violations) {
      const pkgList = (v.packages || [])
        .map((p) => `${p.name}@${p.version}`)
        .join(', ');
      console.error(`- ${v.license}: ${pkgList}`);
    }
    process.exit(1);
  }

  console.log('Production license check passed.');
} catch (err) {
  console.error('Failed to check licenses:', err);
  process.exit(1);
}
