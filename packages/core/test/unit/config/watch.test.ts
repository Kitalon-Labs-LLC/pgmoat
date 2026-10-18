import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { watchConfig } from '../../../src/config/watch.js';
import { loadConfig } from '../../../src/config/load.js';
import type { PgmoatConfigT } from '../../../src/config/schema.js';
import type { PgmoatError } from '../../../src/errors.js';

describe('watchConfig', () => {
  let tmpDir: string;
  let configFile: string;
  let initialConfig: PgmoatConfigT;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgmoat-watch-'));
    configFile = path.join(tmpDir, 'pgmoat.yaml');
    fs.writeFileSync(
      configFile,
      `version: 1
server:
  name: test-watch
connection:
  url: postgresql://localhost/app
budgets:
  max_rows: 100
tables:
  users:
    description: Initial description
`,
    );

    const loaded = loadConfig({ path: configFile });
    if (loaded.kind !== 'file') {
      throw new Error('Failed to load initial config');
    }
    initialConfig = loaded.config;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('applies valid reloadable changes after debounce', async () => {
    return new Promise<void>((resolve, reject) => {
      const unsubscribe = watchConfig(
        configFile,
        initialConfig,
        (newConfig) => {
          try {
            expect(newConfig.budgets.max_rows).toBe(500);
            expect(newConfig.tables.users?.description).toBe('Updated description');
            unsubscribe();
            resolve();
          } catch (err) {
            unsubscribe();
            reject(err);
          }
        },
        (err) => {
          unsubscribe();
          reject(err);
        },
      );

      // Modify reloadable sections
      setTimeout(() => {
        fs.writeFileSync(
          configFile,
          `version: 1
server:
  name: test-watch
connection:
  url: postgresql://localhost/app
budgets:
  max_rows: 500
tables:
  users:
    description: Updated description
`,
        );
      }, 50);
    });
  });

  it('keeps old config and calls onError on invalid edit', async () => {
    return new Promise<void>((resolve, reject) => {
      const unsubscribe = watchConfig(
        configFile,
        initialConfig,
        () => {
          unsubscribe();
          reject(new Error('onChange should not have been called for invalid config'));
        },
        (err: PgmoatError) => {
          try {
            expect(err.code).toBe('PGM-109');
            unsubscribe();
            resolve();
          } catch (e) {
            unsubscribe();
            reject(e);
          }
        },
      );

      // Write invalid YAML
      setTimeout(() => {
        fs.writeFileSync(
          configFile,
          `version: 1
server:
  name: test-watch
connection:
  url: postgresql://localhost/app
budgets:
  max_rows: -50
`,
        );
      }, 50);
    });
  });

  it('warns with restart-required when non-reloadable sections change', async () => {
    return new Promise<void>((resolve, reject) => {
      const unsubscribe = watchConfig(
        configFile,
        initialConfig,
        (newConfig, warnings) => {
          try {
            // URL should NOT have been changed in active config
            expect(newConfig.connection.url).toBe('postgresql://localhost/app');
            // Warning emitted
            expect(warnings.some((w) => w.message.includes('Restart required'))).toBe(true);
            unsubscribe();
            resolve();
          } catch (err) {
            unsubscribe();
            reject(err);
          }
        },
        (err) => {
          unsubscribe();
          reject(err);
        },
      );

      // Change non-reloadable section (connection.url)
      setTimeout(() => {
        fs.writeFileSync(
          configFile,
          `version: 1
server:
  name: test-watch
connection:
  url: postgresql://different-host:5432/app
budgets:
  max_rows: 250
`,
        );
      }, 50);
    });
  });
});
