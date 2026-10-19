import { describe, it, expect } from 'vitest';
import { canonicalJson } from '../../../src/audit/canonical.js';
import { buildEntry, type RequestOutcome, type EntryMeta } from '../../../src/audit/entry.js';
import type { RequestContext } from '../../../src/types.js';

describe('canonicalJson', () => {
  it('sorts keys recursively and produces stable no-whitespace JSON', () => {
    const obj1 = { z: 1, a: { y: 2, b: 3 }, m: [5, 4] };
    const obj2 = { a: { b: 3, y: 2 }, m: [5, 4], z: 1 };

    const canon1 = canonicalJson(obj1);
    const canon2 = canonicalJson(obj2);

    expect(canon1).toBe('{"a":{"b":3,"y":2},"m":[5,4],"z":1}');
    expect(canon1).toBe(canon2);
  });

  it('omits undefined properties but preserves null', () => {
    const obj = { a: undefined, b: null, c: 'hello' };
    expect(canonicalJson(obj)).toBe('{"b":null,"c":"hello"}');
  });

  it('handles primitives, arrays, dates, and bigints', () => {
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson('str')).toBe('"str"');
    expect(canonicalJson(BigInt(100))).toBe('"100"');
    expect(canonicalJson([3, 2, 1])).toBe('[3,2,1]');
    expect(canonicalJson(new Date('2026-01-01T00:00:00.000Z'))).toBe('"2026-01-01T00:00:00.000Z"');
  });
});

describe('buildEntry', () => {
  const baseCtx: RequestContext = {
    requestId: '01JAB3W8K2Q9ABCDEF01234567',
    instanceId: 'inst-xyz',
    startedAt: new Date('2026-10-18T12:00:00.000Z'),
    transport: 'stdio',
    protocolVersion: '2026-07-28',
    client: { name: 'claude-desktop', version: '1.2.3' },
    principal: { kind: 'local', sub: 'local', scopes: new Set(), claims: {} },
    traceId: 'trace-123',
    tool: 'query',
    params: { sql: 'SELECT id FROM users' },
    meta: {},
    signal: new AbortController().signal,
    rls: {
      entries: [['app.tenant_id', 'tnt_1']],
      sources: { 'app.tenant_id': 'env' },
    },
    sqlExecuted: 'SELECT id FROM users LIMIT 201',
    sqlFingerprint: 'SELECT id FROM users LIMIT $1',
    warnings: ['PGM-301 Result capped'],
    rowsReturned: 50,
    payloadBytes: 1240,
  };

  const meta: EntryMeta = {
    serverName: 'acme-db',
    budgetMaxRows: 200,
    budgetMaxQueryMs: 5000,
    durationMs: 34.5,
    unsafeRoleOverride: false,
  };

  it('maps fields correctly for a success outcome', () => {
    const outcome: RequestOutcome = {
      status: 'success',
      rowsReturned: 50,
      rowsAffected: null,
    };

    const entry = buildEntry(baseCtx, outcome, meta);

    expect(entry.request_id).toBe('01JAB3W8K2Q9ABCDEF01234567');
    expect(entry.instance_id).toBe('inst-xyz');
    expect(entry.status).toBe('success');
    expect(entry.error_code).toBeNull();
    expect(entry.error_message).toBeNull();
    expect(entry.rows_returned).toBe(50);
    expect(entry.rows_affected).toBeNull();
    expect(entry.duration_ms).toBe(35);
    expect(entry.budget_max_rows).toBe(200);
    expect(entry.budget_max_query_ms).toBe(5000);
    expect(entry.payload_bytes).toBe(1240);
    expect(entry.rls_context).toEqual({ 'app.tenant_id': 'tnt_1' });
    expect(entry.seq).toBe(0);
    expect(entry.prev_hash).toBe('');
    expect(entry.entry_hash).toBe('');
    expect(entry.dropped_since_last).toBe(0);
    expect(entry.server_name).toBe('acme-db');
  });

  it('maps fields correctly for a refused outcome', () => {
    const outcome: RequestOutcome = {
      status: 'refused',
      errorCode: 'PGM-201',
      errorMessage: 'Statement type not allowed in read-only mode',
    };

    const entry = buildEntry(baseCtx, outcome, meta);

    expect(entry.status).toBe('refused');
    expect(entry.error_code).toBe('PGM-201');
    expect(entry.error_message).toBe('Statement type not allowed in read-only mode');
  });

  it('maps fields correctly for an error outcome', () => {
    const outcome: RequestOutcome = {
      status: 'error',
      errorCode: 'PGM-303',
      errorMessage: 'Statement timeout exceeded',
    };

    const entry = buildEntry(baseCtx, outcome, meta);

    expect(entry.status).toBe('error');
    expect(entry.error_code).toBe('PGM-303');
    expect(entry.error_message).toBe('Statement timeout exceeded');
  });

  it('maps fields correctly for a canceled outcome', () => {
    const outcome: RequestOutcome = {
      status: 'canceled',
      errorCode: 'PGM-505',
      errorMessage: 'Query canceled by client disconnect',
    };

    const entry = buildEntry(baseCtx, outcome, meta);

    expect(entry.status).toBe('canceled');
    expect(entry.error_code).toBe('PGM-505');
  });
});

