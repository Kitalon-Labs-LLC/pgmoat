import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { findConfig, loadConfig } from '../../../src/config/load.js';
import { isPgmoatError } from '../../../src/errors.js';

describe('loadConfig and findConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgmoat-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('respects search order precedence', () => {
    const cwd = path.join(tmpDir, 'project');
    fs.mkdirSync(cwd, { recursive: true });

    const localConfig = path.join(cwd, 'pgmoat.yaml');
    fs.writeFileSync(
      localConfig,
      'version: 1\nserver:\n  name: local\nconnection:\n  url: postgresql://localhost/db\n',
    );

    const envConfig = path.join(tmpDir, 'env-config.yaml');
    fs.writeFileSync(
      envConfig,
      'version: 1\nserver:\n  name: env\nconnection:\n  url: postgresql://localhost/db\n',
    );

    // 1. Local ./pgmoat.yaml found
    const res1 = findConfig({ cwd, env: {} });
    expect(res1.kind).toBe('file');
    if (res1.kind === 'file') {
      expect(res1.path).toBe(localConfig);
    }

    // 2. $PGMOAT_CONFIG takes precedence over ./pgmoat.yaml
    const res2 = findConfig({ cwd, env: { PGMOAT_CONFIG: envConfig } });
    expect(res2.kind).toBe('file');
    if (res2.kind === 'file') {
      expect(res2.path).toBe(envConfig);
    }

    // 3. Explicit path takes precedence over both
    const explicitConfig = path.join(tmpDir, 'explicit.yaml');
    fs.writeFileSync(
      explicitConfig,
      'version: 1\nserver:\n  name: explicit\nconnection:\n  url: postgresql://localhost/db\n',
    );
    const res3 = findConfig({
      cwd,
      path: explicitConfig,
      env: { PGMOAT_CONFIG: envConfig },
    });
    expect(res3.kind).toBe('file');
    if (res3.kind === 'file') {
      expect(res3.path).toBe(explicitConfig);
    }
  });

  it('returns kind: none when no config is found', () => {
    const emptyDir = path.join(tmpDir, 'empty');
    fs.mkdirSync(emptyDir, { recursive: true });
    const res = findConfig({
      cwd: emptyDir,
      env: { HOME: emptyDir, XDG_CONFIG_HOME: emptyDir },
    });
    expect(res.kind).toBe('none');

    const loaded = loadConfig({
      cwd: emptyDir,
      env: { HOME: emptyDir, XDG_CONFIG_HOME: emptyDir },
    });
    expect(loaded.kind).toBe('none');
  });

  it('reports syntax error with line and column (PGM-107)', () => {
    const brokenFile = path.join(tmpDir, 'broken.yaml');
    fs.writeFileSync(brokenFile, 'version: 1\nserver: [invalid yaml:');

    try {
      loadConfig({ path: brokenFile });
      expect.fail('should have thrown');
    } catch (err) {
      expect(isPgmoatError(err)).toBe(true);
      if (isPgmoatError(err)) {
        expect(err.code).toBe('PGM-107');
        expect(err.message).toMatch(/broken\.yaml:\d+:\d+/);
      }
    }
  });

  it('reports schema validation error with line and column (PGM-109)', () => {
    const invalidFile = path.join(tmpDir, 'invalid.yaml');
    fs.writeFileSync(
      invalidFile,
      'version: 1\nserver:\n  name: pgmoat\nbudgets:\n  max_rows: -10\nconnection:\n  url: postgresql://localhost/db\n',
    );

    try {
      loadConfig({ path: invalidFile });
      expect.fail('should have thrown');
    } catch (err) {
      expect(isPgmoatError(err)).toBe(true);
      if (isPgmoatError(err)) {
        expect(err.code).toBe('PGM-109');
        expect(err.message).toMatch(/invalid\.yaml:5:\d+ budgets\.max_rows:/);
      }
    }
  });

  it('aggregates multiple errors into a single PgmoatError', () => {
    const multiErrorFile = path.join(tmpDir, 'multi.yaml');
    fs.writeFileSync(
      multiErrorFile,
      'version: 1\nserver:\n  name: INVALID_NAME\nconnection:\n  url: postgresql://localhost/db\n  pool:\n    min: 10\n    max: 2\n',
    );

    try {
      loadConfig({ path: multiErrorFile });
      expect.fail('should have thrown');
    } catch (err) {
      expect(isPgmoatError(err)).toBe(true);
      if (isPgmoatError(err)) {
        expect(err.code).toBe('PGM-109');
        expect(err.message).toContain('server.name');
      }
    }
  });

  it('returns warnings from checkConfig', () => {
    const warningFile = path.join(tmpDir, 'warning.yaml');
    fs.writeFileSync(
      warningFile,
      'version: 1\nserver:\n  name: test-warn\ntransport: http\nhttp:\n  public_url: "https://mcp.example.com"\nauth:\n  mode: oauth\n  issuer: "https://auth.example.com"\n  audience: "https://different.example.com"\n  jwks_url: "https://auth.example.com/jwks.json"\nconnection:\n  url: postgresql://localhost/db\n',
    );

    const loaded = loadConfig({ path: warningFile, strict: false });
    expect(loaded.kind).toBe('file');
    if (loaded.kind === 'file') {
      expect(loaded.warnings.some((w) => w.code === 'PGM-117')).toBe(true);
      expect(Object.isFrozen(loaded.config)).toBe(true);
      expect(Object.isFrozen(loaded.config.server)).toBe(true);
    }
  });
});
