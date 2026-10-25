import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startPostgres, connectionUrl, stopPostgres } from './harness/postgres.js';
import { initCommand } from '../../../cli/src/commands/init.js';
import { loadConfig } from '../../src/config/load.js';

describe('CLI init integration (P8.4)', () => {
  beforeAll(async () => {
    await startPostgres();
  }, 60000);

  afterAll(async () => {
    await stopPostgres();
  });

  it('runs init --yes against seed DB in under 10s and produces loadable config', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgmoat-init-int-'));
    const startTs = Date.now();

    try {
      await initCommand({
        url: connectionUrl('pgmoat_reader'),
        out: tmpDir,
        yes: true,
      });

      const elapsed = Date.now() - startTs;
      expect(elapsed).toBeLessThan(10000);

      const generatedFile = path.join(tmpDir, 'pgmoat.yaml');
      expect(fs.existsSync(generatedFile)).toBe(true);

      const loaded = loadConfig({ path: generatedFile });
      expect(loaded.kind).toBe('file');
      if (loaded.kind === 'file') {
        expect(loaded.config.version).toBe(1);
        expect(loaded.config.mode).toBe('read-only');
        expect(loaded.config.transport).toBe('stdio');
        // Check that auto-hide marked password_hash or similar hidden
        const usersTable = loaded.config.tables.users;
        if (usersTable?.columns) {
          expect(usersTable.columns.password_hash?.hidden).toBe(true);
        }
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);
});
