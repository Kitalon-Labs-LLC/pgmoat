import { describe, it, expect } from 'vitest';
import { redactEntry } from '../../../src/audit/redact.js';
import type { AuditEntry } from '../../../src/types.js';

describe('redactEntry', () => {
  const baseEntry: AuditEntry = {
    request_id: '01JAB3W8K2Q9ABCDEF01234567',
    instance_id: 'inst-test',
    seq: 1,
    ts: '2026-10-18T12:00:00.000Z',
    transport: 'stdio',
    protocol_version: '2026-07-28',
    client_name: 'test-client',
    client_version: '1.0.0',
    principal: 'local',
    trace_id: null,
    tool: 'query',
    params: {
      user_id: 123,
      password: 'my-super-secret-password',
      meta: {
        nested_token: 'secret-token-xyz',
        safe_info: 'visible',
      },
    },
    sql_executed: "SELECT * FROM users WHERE password = 'hunter2'",
    sql_fingerprint: 'SELECT * FROM users WHERE password = $1',
    rls_context: {
      'app.tenant_id': 'tnt_abc',
      'app.api_token': 'sk_live_123456789',
    },
    status: 'success',
    error_code: null,
    error_message: null,
    warnings: [],
    rows_returned: 1,
    rows_affected: null,
    duration_ms: 12,
    budget_max_rows: 200,
    budget_max_query_ms: 5000,
    payload_bytes: 500,
    prev_hash: '',
    entry_hash: '',
    dropped_since_last: 0,
    unsafe_role_override: false,
    pgmoat_version: '0.0.0',
    server_name: 'pgmoat',
  };

  it('redacts WHERE password = "hunter2" in sql_executed', async () => {
    const redacted = await redactEntry(baseEntry);
    expect(redacted.sql_executed).toContain("password = '[REDACTED]'");
    expect(redacted.sql_executed).not.toContain('hunter2');
  });

  it('does NOT redact WHERE email IN ("a","b") unless email is in redact_fields', async () => {
    const entry: AuditEntry = {
      ...baseEntry,
      sql_executed: "SELECT * FROM users WHERE email IN ('a', 'b')",
    };

    const redacted = await redactEntry(entry);
    expect(redacted.sql_executed).toContain("'a'");
    expect(redacted.sql_executed).toContain("'b'");
    expect(redacted.sql_executed).not.toContain('[REDACTED]');
  });

  it('redacts WHERE email IN ("a","b") if email IS added to redact_fields', async () => {
    const entry: AuditEntry = {
      ...baseEntry,
      sql_executed: "SELECT * FROM users WHERE email IN ('a', 'b')",
    };

    const redacted = await redactEntry(entry, {
      redact_fields: ['email'],
    });
    expect(redacted.sql_executed).toContain("email IN ('[REDACTED]', '[REDACTED]')");
  });

  it('redacts sensitive keys in nested params', async () => {
    const redacted = await redactEntry(baseEntry);
    expect(redacted.params['password']).toBe('[REDACTED]');
    expect((redacted.params['meta'] as Record<string, unknown>)['nested_token']).toBe(
      '[REDACTED]',
    );
    expect((redacted.params['meta'] as Record<string, unknown>)['safe_info']).toBe(
      'visible',
    );
  });

  it('redacts rls_context key matching redact_fields (app.api_token)', async () => {
    const redacted = await redactEntry(baseEntry);
    expect(redacted.rls_context?.['app.api_token']).toBe('[REDACTED]');
    expect(redacted.rls_context?.['app.tenant_id']).toBe('tnt_abc');
  });

  it('redacts SSN regex patterns in error messages', async () => {
    const entry: AuditEntry = {
      ...baseEntry,
      status: 'error',
      error_code: 'PGM-501',
      error_message: 'Failed to process customer with SSN 123-45-6789 in table',
    };

    const redacted = await redactEntry(entry);
    expect(redacted.error_message).toBe(
      'Failed to process customer with SSN [REDACTED] in table',
    );
  });

  it('replaces unparseable SQL with [REDACTED: unparseable]', async () => {
    const entry: AuditEntry = {
      ...baseEntry,
      sql_executed: 'SELECT * FROM ;;; INVALID SQL SYNTAX ???',
    };

    const redacted = await redactEntry(entry);
    expect(redacted.sql_executed).toBe('[REDACTED: unparseable]');
  });
});
