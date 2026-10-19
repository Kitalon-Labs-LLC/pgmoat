import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Chain,
  type AuditEntry,
  type VerifyReport,
} from '@pgmoat/core';
import {
  parseDuration,
  parseSince,
  filterEntry,
  formatTailRow,
  formatQueryRow,
  renderVerifyHuman,
  auditCommand,
} from '../src/commands/audit.js';
import { resetOutputConfig } from '../src/output.js';

function createDummyEntry(instanceId: string, seq: number, overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    request_id: `req_${seq}_${instanceId.slice(0, 4)}`,
    instance_id: instanceId,
    seq,
    ts: '2026-12-08T14:23:11.000Z',
    transport: 'stdio',
    protocol_version: '2024-11-05',
    client_name: 'claude-code',
    client_version: '2.9.1',
    principal: 'local',
    trace_id: null,
    tool: 'query',
    params: { sql: 'SELECT 1' },
    sql_executed: 'SELECT 1',
    sql_fingerprint: 'fp_123',
    rls_context: { tenant_id: 'tnt_abc' },
    status: 'success',
    error_code: null,
    error_message: null,
    warnings: [],
    rows_returned: 1,
    rows_affected: null,
    duration_ms: 31,
    budget_max_rows: 200,
    budget_max_query_ms: 5000,
    payload_bytes: 42,
    prev_hash: '',
    entry_hash: '',
    dropped_since_last: 0,
    unsafe_role_override: false,
    pgmoat_version: '1.0.0',
    server_name: 'test-server',
    ...overrides,
  };
}

describe('CLI audit command (P8.5)', () => {
  let tmpDir: string;

  beforeEach(() => {
    resetOutputConfig();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgmoat-audit-test-'));
  });

  afterEach(() => {
    resetOutputConfig();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('duration and since parser', () => {
    it('parses duration strings correctly', () => {
      expect(parseDuration('10s')).toBe(10_000);
      expect(parseDuration('30m')).toBe(30 * 60 * 1000);
      expect(parseDuration('1h')).toBe(60 * 60 * 1000);
      expect(parseDuration('7d')).toBe(7 * 24 * 60 * 60 * 1000);
      expect(() => parseDuration('invalid')).toThrow('Invalid duration string');
    });

    it('parses relative and absolute since strings', () => {
      const now = Date.now();
      const relativeDate = parseSince('1h');
      expect(relativeDate.getTime()).toBeLessThanOrEqual(now - 3590000);

      const abs = parseSince('2026-10-01T00:00:00Z');
      expect(abs.toISOString()).toBe('2026-10-01T00:00:00.000Z');

      expect(() => parseSince('not-a-date')).toThrow('Invalid date/time');
    });
  });

  describe('filtering', () => {
    const entry = createDummyEntry('inst1', 0, {
      ts: '2026-11-01T10:00:00Z',
      tool: 'query',
      status: 'refused',
      principal: 'agent_user',
      rls_context: { tenant_id: 'tnt_abc' },
    });

    it('filters by tool', () => {
      expect(filterEntry(entry, { tool: 'query' })).toBe(true);
      expect(filterEntry(entry, { tool: 'describe_table' })).toBe(false);
    });

    it('filters by status', () => {
      expect(filterEntry(entry, { status: 'refused' })).toBe(true);
      expect(filterEntry(entry, { status: 'success' })).toBe(false);
    });

    it('filters by principal', () => {
      expect(filterEntry(entry, { principal: 'agent_user' })).toBe(true);
      expect(filterEntry(entry, { principal: 'other_user' })).toBe(false);
    });

    it('filters by tenant', () => {
      expect(filterEntry(entry, { tenant: 'tnt_abc' })).toBe(true);
      expect(filterEntry(entry, { tenant: 'tnt_xyz' })).toBe(false);
    });

    it('filters by time window', () => {
      expect(filterEntry(entry, { since: new Date('2026-10-01') })).toBe(true);
      expect(filterEntry(entry, { since: new Date('2026-12-01') })).toBe(false);
      expect(filterEntry(entry, { until: new Date('2026-12-01') })).toBe(true);
      expect(filterEntry(entry, { until: new Date('2026-10-01') })).toBe(false);
    });
  });

  describe('row formatting', () => {
    it('formats tail row matching spec layout', () => {
      const entry = createDummyEntry('01JAB300000000000000000000', 0, {
        request_id: '01JAB3456789',
        client_name: 'claude-code',
        client_version: '2.9.1',
        principal: 'local',
        tool: 'query',
        status: 'success',
        rows_returned: 1,
        duration_ms: 31,
      });

      const formatted = formatTailRow(entry);
      expect(formatted).toContain('01JAB3..');
      expect(formatted).toContain('claude-code 2.9.1');
      expect(formatted).toContain('local');
      expect(formatted).toContain('query');
      expect(formatted).toContain('success');
      expect(formatted).toContain('1 row');
      expect(formatted).toContain('31 ms');
    });

    it('formats query row matching spec layout', () => {
      const entry = createDummyEntry('01JA9X00000000000000000000', 0, {
        request_id: '01JA9X123456',
        ts: '2026-11-02T09:11:22.000Z',
        principal: 'user_8812',
        tool: 'query',
        status: 'refused',
        error_code: 'PGM-207',
        sql_executed: 'SELECT * FROM internal_audit',
      });

      const formatted = formatQueryRow(entry);
      expect(formatted).toContain('01JA9X..');
      expect(formatted).toContain('2026-11-02 09:11:22');
      expect(formatted).toContain('user_8812');
      expect(formatted).toContain('query');
      expect(formatted).toContain('PGM-207');
      expect(formatted).toContain('SELECT * FROM internal_audit');
    });
  });

  describe('human verify renderer', () => {
    it('renders intact report with exact specimen wording', () => {
      const report: VerifyReport = {
        allIntact: true,
        totalEntries: 13530,
        instances: [
          {
            instanceId: '01JA7Q00000000000000000000',
            status: 'intact',
            totalEntries: 9121,
            firstSeq: 0,
            lastSeq: 9120,
            intact: true,
            droppedRecorded: 0,
            reordered: false,
          },
          {
            instanceId: '01JA9B00000000000000000000',
            status: 'intact',
            totalEntries: 4411,
            firstSeq: 0,
            lastSeq: 4410,
            intact: true,
            droppedRecorded: 0,
            reordered: false,
          },
        ],
      };

      const output = renderVerifyHuman(2, report);
      expect(output).toContain('Verifying 2 files, 2 instances, 13,530 entries ...');
      expect(output).toContain('ok instance 01JA7Q..  seq 0..9120     intact');
      expect(output).toContain('ok instance 01JA9B..  seq 0..4410     intact');
      expect(output).toContain('Result: all instances intact.');
    });

    it('renders dropped warning and hash mismatch failure', () => {
      const report: VerifyReport = {
        allIntact: false,
        totalEntries: 4889,
        instances: [
          {
            instanceId: '01JAA000000000000000000000',
            status: 'intact',
            totalEntries: 2211,
            firstSeq: 0,
            lastSeq: 2210,
            intact: true,
            droppedRecorded: 2,
            reordered: false,
          },
          {
            instanceId: '01JAB000000000000000000000',
            status: 'edited',
            totalEntries: 2679,
            firstSeq: 0,
            lastSeq: 2678,
            intact: false,
            badSeq: 1203,
            droppedRecorded: 0,
            reordered: false,
          },
        ],
      };

      const output = renderVerifyHuman(2, report);
      expect(output).toContain('!  instance 01JAA0..  seq 0..2210     2 dropped entries recorded (buffer overflow)');
      expect(output).toContain('x  instance 01JAB0..  seq 0..2678     hash mismatch at seq 1203 (entry edited or corrupted)');
      expect(output).toContain('Result: 1 instance failed verification.');
    });
  });

  describe('file destination audit command execution', () => {
    const instId = '01JAB300000000000000000000';

    beforeEach(() => {
      // Create valid ndjson file with 3 sealed entries
      const chain = new Chain(instId);
      const e0 = chain.seal(createDummyEntry(instId, 0, { tool: 'query', rows_returned: 1 }));
      const e1 = chain.seal(
        createDummyEntry(instId, 1, {
          tool: 'query',
          status: 'refused',
          error_code: 'PGM-204',
          rows_returned: null,
          duration_ms: 2,
        }),
      );
      const e2 = chain.seal(
        createDummyEntry(instId, 2, {
          tool: 'describe_table',
          status: 'success',
          rows_returned: null,
          duration_ms: 6,
        }),
      );

      const filePath = path.join(tmpDir, 'audit-001.ndjson');
      fs.writeFileSync(filePath, [JSON.stringify(e0), JSON.stringify(e1), JSON.stringify(e2)].join('\n') + '\n');
    });

    it('runs audit tail in table format', async () => {
      let stdout = '';
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((str) => {
        stdout += str;
        return true;
      });

      try {
        await auditCommand('tail', { path: tmpDir, format: 'table' });
        expect(stdout).toContain('3 entries');
        expect(stdout).toContain('query');
        expect(stdout).toContain('describe_table');
        expect(stdout).toContain('PGM-204');
      } finally {
        writeSpy.mockRestore();
      }
    });

    it('runs audit tail in ndjson and csv formats', async () => {
      let stdout = '';
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((str) => {
        stdout += str;
        return true;
      });

      try {
        await auditCommand('tail', { path: tmpDir, format: 'ndjson' });
        const lines = stdout.trim().split('\n');
        expect(lines.length).toBe(3);
        const parsed = JSON.parse(lines[0] ?? '{}') as AuditEntry;
        expect(parsed.instance_id).toBe(instId);

        stdout = '';
        await auditCommand('tail', { path: tmpDir, format: 'csv' });
        expect(stdout).toContain('ts,request_id,principal,tool,status,error_code,duration_ms');
      } finally {
        writeSpy.mockRestore();
      }
    });

    it('runs audit query filtering by status', async () => {
      let stdout = '';
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((str) => {
        stdout += str;
        return true;
      });

      try {
        await auditCommand('query', { path: tmpDir, status: 'refused' });
        expect(stdout).toContain('1 refused calls');
        expect(stdout).toContain('PGM-204');
      } finally {
        writeSpy.mockRestore();
      }
    });

    it('runs audit verify on intact logs', async () => {
      let stdout = '';
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((str) => {
        stdout += str;
        return true;
      });

      try {
        await auditCommand('verify', { path: tmpDir });
        expect(stdout).toContain('Verifying 1 file, 1 instance, 3 entries ...');
        expect(stdout).toContain('ok instance 01JAB3..  seq 0..2        intact');
        expect(stdout).toContain('Result: all instances intact.');
      } finally {
        writeSpy.mockRestore();
      }
    });

    it('detects tampered logs and exits with failure', async () => {
      // Create a corrupted file where seq 1 was altered after sealing
      const corruptChain = new Chain('corrupt_inst');
      const c0 = corruptChain.seal(createDummyEntry('corrupt_inst', 0));
      const c1 = corruptChain.seal(createDummyEntry('corrupt_inst', 1));
      // Tamper c1
      const tamperedC1 = { ...c1, sql_executed: 'SELECT * FROM tampered' };

      const corruptFile = path.join(tmpDir, 'corrupt.ndjson');
      fs.writeFileSync(corruptFile, [JSON.stringify(c0), JSON.stringify(tamperedC1)].join('\n') + '\n');

      let stdout = '';
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((str) => {
        stdout += str;
        return true;
      });

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`process.exit called with code ${code}`);
      });

      try {
        await expect(auditCommand('verify', { path: tmpDir })).rejects.toThrow('process.exit called with code 1');
        expect(stdout).toContain('hash mismatch at seq 1 (entry edited or corrupted)');
        expect(stdout).toContain('Result: 1 instance failed verification.');
      } finally {
        writeSpy.mockRestore();
        exitSpy.mockRestore();
      }
    });

    it('prunes files older than threshold with --dry-run and live prune', async () => {
      const oldFile = path.join(tmpDir, 'old-audit.ndjson');
      fs.writeFileSync(oldFile, '{}\n');
      const pastTime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      fs.utimesSync(oldFile, pastTime, pastTime);

      let stdout = '';
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((str) => {
        stdout += str;
        return true;
      });

      try {
        // Dry run
        await auditCommand('prune', { path: tmpDir, olderThan: '30d', dryRun: true });
        expect(stdout).toContain('Dry run: 1 file(s) would be pruned');
        expect(fs.existsSync(oldFile)).toBe(true);

        stdout = '';
        // Live run
        await auditCommand('prune', { path: tmpDir, olderThan: '30d', dryRun: false });
        expect(stdout).toContain('Pruned 1 file(s)');
        expect(fs.existsSync(oldFile)).toBe(false);
      } finally {
        writeSpy.mockRestore();
      }
    });
  });
});

