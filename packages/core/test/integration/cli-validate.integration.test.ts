import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startPostgres, connectionUrl, stopPostgres } from './harness/postgres.js';
import { validateCommand } from '../../../cli/src/commands/validate.js';

describe('CLI validate command integration (P8.2)', () => {
  beforeAll(async () => {
    await startPostgres();
  }, 60000);

  afterAll(async () => {
    await stopPostgres();
  });

  it('validates configuration and annotations against seed database', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgmoat-validate-'));
    const cfgPath = path.join(tmpDir, 'pgmoat.yaml');

    const yamlContent = `version: 1
server:
  name: test-validate
  description: Validate test against seed DB

transport: stdio

connection:
  url: ${connectionUrl('pgmoat_reader')}
  schemas: [public]

mode: read-only

budgets:
  max_rows: 200
  max_query_ms: 5000
  max_payload_bytes: 65536

policy:
  allow_catalog_queries: false

tables:
  orders:
    description: "Customer orders table"
    columns:
      id: { description: "Primary key" }
      customer_id: { description: "Customer reference" }
`;

    fs.writeFileSync(cfgPath, yamlContent, 'utf8');

    const stdoutChunks: string[] = [];
    const origStdout = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write;

    try {
      await validateCommand({ config: cfgPath, strict: false });
      const out = stdoutChunks.join('');

      expect(out).toContain('pgmoat.yaml is valid');
      expect(out).toContain('Connected');
      expect(out).toContain('Postgres');
      expect(out).toContain('Annotations match the database');
    } finally {
      process.stdout.write = origStdout;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
