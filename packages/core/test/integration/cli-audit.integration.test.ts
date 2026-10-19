import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import pg from 'pg';
import {
  startPostgres,
  connectionUrl,
  stopPostgres,
} from './harness/postgres.js';
import {
  Chain,
  PostgresDestination,
  type AuditEntry,
} from '../../src/index.js';
import { auditCommand } from '../../../cli/src/commands/audit.js';

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
    principal: 'agent_user',
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
    duration_ms: 25,
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

describe('CLI audit command Postgres integration (P8.5)', () => {
  const instId = '01JAB300000000000000000000';
  let dest: PostgresDestination | undefined;

  beforeAll(async () => {
    await startPostgres();
  }, 60000);

  afterAll(async () => {
    if (dest) {
      await dest.close().catch(() => {});
    }
    await stopPostgres();
  });

  it('verifies, queries, and detects tampering in Postgres audit table', async () => {
    const adminUrl = connectionUrl('postgres');
    dest = new PostgresDestination({ url: adminUrl });
    await dest.init();

    // Clean any prior audit rows
    const client = new pg.Client({ connectionString: adminUrl });
    await client.connect();
    try {
      await client.query('DELETE FROM pgmoat.audit');
    } finally {
      await client.end().catch(() => {});
    }

    // 1. Write sealed audit entries
    const chain = new Chain(instId);
    const e0 = chain.seal(createDummyEntry(instId, 0, { tool: 'query', rows_returned: 1 }));
    const e1 = chain.seal(
      createDummyEntry(instId, 1, {
        tool: 'describe_table',
        status: 'success',
        duration_ms: 12,
      }),
    );

    await dest.write([e0, e1]);

    // 2. Run verify --postgres (should pass)
    let stdout = '';
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((str) => {
      stdout += str;
      return true;
    });

    try {
      await auditCommand('verify', { postgres: true, url: adminUrl });
      expect(stdout).toContain('ok instance 01JAB3..  seq 0..1        intact');
      expect(stdout).toContain('Result: all instances intact.');
    } finally {
      writeSpy.mockRestore();
    }

    // 3. Run query --postgres
    stdout = '';
    const writeSpyQuery = vi.spyOn(process.stdout, 'write').mockImplementation((str) => {
      stdout += str;
      return true;
    });

    try {
      await auditCommand('query', { postgres: true, url: adminUrl, tool: 'query' });
      expect(stdout).toContain('1 calls');
      expect(stdout).toContain('agent_user');
      expect(stdout).toContain('query');
    } finally {
      writeSpyQuery.mockRestore();
    }

    // 4. Tamper with row at seq 1 in database
    const tamperClient = new pg.Client({ connectionString: adminUrl });
    await tamperClient.connect();
    try {
      await tamperClient.query("UPDATE pgmoat.audit SET sql_executed = 'TAMPERED SQL' WHERE seq = 1");
    } finally {
      await tamperClient.end().catch(() => {});
    }

    // 5. Run verify --postgres (should fail at seq 1)
    stdout = '';
    const writeSpyTamper = vi.spyOn(process.stdout, 'write').mockImplementation((str) => {
      stdout += str;
      return true;
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit called with code ${code}`);
    });

    try {
      await expect(auditCommand('verify', { postgres: true, url: adminUrl })).rejects.toThrow(
        'process.exit called with code 1',
      );
      expect(stdout).toContain('hash mismatch at seq 1 (entry edited or corrupted)');
      expect(stdout).toContain('Result: 1 instance failed verification.');
    } finally {
      writeSpyTamper.mockRestore();
      exitSpy.mockRestore();
    }
  });
});
