import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  FileDestination,
  prune,
  parseRotationConfig,
  formatUtcDate,
} from '../../../src/audit/destinations/file.js';
import { getDefaultAuditDir } from '../../../src/audit/paths.js';
import { buildEntry, type RequestOutcome, type EntryMeta } from '../../../src/audit/entry.js';
import type { AuditEntry, RequestContext } from '../../../src/types.js';

function createDummyEntry(query = 'SELECT 1'): AuditEntry {
  const ctx: RequestContext = {
    requestId: '01JAB3W8K2Q9ABCDEF01234567',
    instanceId: 'inst-file-test',
    startedAt: new Date('2026-10-18T12:00:00.000Z'),
    transport: 'stdio',
    protocolVersion: '2026-07-28',
    client: { name: 'claude-desktop', version: '1.2.3' },
    principal: { kind: 'local', sub: 'local', scopes: new Set(), claims: {} },
    traceId: 'trace-123',
    tool: 'query',
    params: { sql: query },
    meta: {},
    signal: new AbortController().signal,
    warnings: [],
    sqlExecuted: query,
  };
  const outcome: RequestOutcome = {
    status: 'success',
    rowsReturned: 1,
    rowsAffected: null,
  };
  const meta: EntryMeta = {
    budgetMaxRows: 200,
    budgetMaxQueryMs: 5000,
    durationMs: 5,
  };
  return buildEntry(ctx, outcome, meta);
}

describe('FileDestination & Paths', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pgmoat-audit-test-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  describe('getDefaultAuditDir', () => {
    it('resolves correct paths per operating system', () => {
      // Linux with XDG_STATE_HOME
      expect(
        getDefaultAuditDir('linux', { XDG_STATE_HOME: '/custom/xdg/state' }),
      ).toBe('/custom/xdg/state/pgmoat/audit');

      // Linux fallback to ~/.local/state
      expect(
        getDefaultAuditDir('linux', { HOME: '/home/alice' }),
      ).toBe('/home/alice/.local/state/pgmoat/audit');

      // macOS (darwin)
      expect(
        getDefaultAuditDir('darwin', { HOME: '/Users/alice' }),
      ).toBe('/Users/alice/Library/Application Support/pgmoat/audit');

      // Windows (win32)
      expect(
        getDefaultAuditDir('win32', { LOCALAPPDATA: 'C:\\Users\\alice\\AppData\\Local' }),
      ).toBe('C:\\Users\\alice\\AppData\\Local\\pgmoat\\audit');
    });
  });

  describe('parseRotationConfig', () => {
    it('parses daily and size rotations correctly', () => {
      expect(parseRotationConfig()).toEqual({ mode: 'daily' });
      expect(parseRotationConfig('daily')).toEqual({ mode: 'daily' });
      expect(parseRotationConfig('size:500KB')).toEqual({ mode: 'size', maxBytes: 500 * 1024 });
      expect(parseRotationConfig('size:10MB')).toEqual({ mode: 'size', maxBytes: 10 * 1024 * 1024 });
      expect(parseRotationConfig('size:1GB')).toEqual({ mode: 'size', maxBytes: 1024 * 1024 * 1024 });
      expect(parseRotationConfig('unknown')).toEqual({ mode: 'daily' });
    });
  });

  describe('Daily rotation at midnight UTC', () => {
    it('rotates to a new file when UTC midnight passes', async () => {
      let currentTime = new Date('2026-10-18T23:59:50.000Z').getTime();
      const clock = { now: () => currentTime };

      const dest = new FileDestination({
        dir: tempDir,
        rotation: 'daily',
        clock,
      });

      const entry1 = createDummyEntry('SELECT 1');
      await dest.write([entry1]);

      const file1 = path.join(tempDir, 'audit-2026-10-18.ndjson');
      expect(fs.existsSync(file1)).toBe(true);
      expect(dest.activeFilePath).toBe(file1);

      // Advance clock past UTC midnight
      currentTime = new Date('2026-10-19T00:00:10.000Z').getTime();

      const entry2 = createDummyEntry('SELECT 2');
      await dest.write([entry2]);

      const file2 = path.join(tempDir, 'audit-2026-10-19.ndjson');
      expect(fs.existsSync(file2)).toBe(true);
      expect(dest.activeFilePath).toBe(file2);

      await dest.close();

      const content1 = await fs.promises.readFile(file1, 'utf-8');
      expect(content1).toContain('SELECT 1');
      expect(content1).not.toContain('SELECT 2');

      const content2 = await fs.promises.readFile(file2, 'utf-8');
      expect(content2).toContain('SELECT 2');
      expect(content2).not.toContain('SELECT 1');
    });
  });

  describe('Size rotation', () => {
    it('rotates to audit-YYYY-MM-DD-N.ndjson when maxBytes is exceeded', async () => {
      const fixedTime = new Date('2026-10-18T12:00:00.000Z').getTime();
      const clock = { now: () => fixedTime };

      // Set maxBytes to 800 bytes (each entry is ~700 bytes)
      const dest = new FileDestination({
        dir: tempDir,
        rotation: 'size:1KB', // 1024 bytes
        clock,
      });

      const entry1 = createDummyEntry('SELECT 1');
      await dest.write([entry1]);

      const file0 = path.join(tempDir, 'audit-2026-10-18.ndjson');
      expect(fs.existsSync(file0)).toBe(true);

      const entry2 = createDummyEntry('SELECT 2');
      await dest.write([entry2]);

      const file1 = path.join(tempDir, 'audit-2026-10-18-1.ndjson');
      expect(fs.existsSync(file1)).toBe(true);

      const entry3 = createDummyEntry('SELECT 3');
      await dest.write([entry3]);

      const file2 = path.join(tempDir, 'audit-2026-10-18-2.ndjson');
      expect(fs.existsSync(file2)).toBe(true);

      await dest.close();

      const content0 = await fs.promises.readFile(file0, 'utf-8');
      const content1 = await fs.promises.readFile(file1, 'utf-8');
      const content2 = await fs.promises.readFile(file2, 'utf-8');

      expect(content0).toContain('SELECT 1');
      expect(content1).toContain('SELECT 2');
      expect(content2).toContain('SELECT 3');
    });
  });

  describe('POSIX Permissions', () => {
    it('creates directories with 0700 and files with 0600 on POSIX', async () => {
      if (process.platform === 'win32') {
        return;
      }

      const auditDir = path.join(tempDir, 'sub', 'audit');
      const dest = new FileDestination({
        dir: auditDir,
      });

      await dest.write([createDummyEntry()]);
      await dest.close();

      const dirStat = await fs.promises.stat(auditDir);
      // Mode 0700: user rwx (0700 & 0777 === 0700)
      expect(dirStat.mode & 0o777).toBe(0o700);

      const todayStr = formatUtcDate(Date.now());
      const filePath = path.join(auditDir, `audit-${todayStr}.ndjson`);
      const fileStat = await fs.promises.stat(filePath);
      // Mode 0600: user rw (0600 & 0777 === 0600)
      expect(fileStat.mode & 0o777).toBe(0o600);
    });
  });

  describe('prune', () => {
    it('prunes files older than olderThanDays and respects dryRun', async () => {
      const now = new Date('2026-10-20T00:00:00.000Z').getTime();
      const clock = { now: () => now };

      // Create files:
      // 1. 100 days old: 2026-07-12
      // 2. 91 days old:  2026-07-21
      // 3. 10 days old:  2026-10-10
      // 4. Non-audit file: notes.txt
      const f1 = path.join(tempDir, 'audit-2026-07-12.ndjson');
      const f2 = path.join(tempDir, 'audit-2026-07-21-1.ndjson');
      const f3 = path.join(tempDir, 'audit-2026-10-10.ndjson');
      const fOther = path.join(tempDir, 'notes.txt');

      await fs.promises.writeFile(f1, 'line1\nline2\n');
      await fs.promises.writeFile(f2, 'line3\n');
      await fs.promises.writeFile(f3, 'line4\nline5\nline6\n');
      await fs.promises.writeFile(fOther, 'keep me');

      // Dry run for olderThanDays = 90
      const dryResult = await prune(tempDir, 90, true, clock);
      expect(dryResult.deleted.sort()).toEqual([f1, f2].sort());
      expect(dryResult.preserved).toContain(f3);
      expect(dryResult.bytesFreed).toBeGreaterThan(0);
      expect(fs.existsSync(f1)).toBe(true);
      expect(fs.existsSync(f2)).toBe(true);

      // Real prune for olderThanDays = 90
      const realResult = await prune(tempDir, 90, false, clock);
      expect(realResult.deleted.sort()).toEqual([f1, f2].sort());
      expect(realResult.preserved).toContain(f3);
      expect(fs.existsSync(f1)).toBe(false);
      expect(fs.existsSync(f2)).toBe(false);
      expect(fs.existsSync(f3)).toBe(true);
      expect(fs.existsSync(fOther)).toBe(true);
    });
  });
});

