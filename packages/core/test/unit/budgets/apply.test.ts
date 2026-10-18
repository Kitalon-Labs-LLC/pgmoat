import { describe, it, expect } from 'vitest';
import { applyBudgets } from '../../../src/budgets/index.js';
import type { ExecResult } from '../../../src/types.js';
import type { PgmoatConfigT } from '../../../src/config/schema.js';

describe('applyBudgets', () => {
  const defaultBudgets: PgmoatConfigT['budgets'] = {
    max_rows: 5,
    max_query_ms: 5000,
    max_explain_ms: 500,
    lock_timeout_ms: 1000,
    max_columns: 3,
    max_payload_bytes: 5000,
    max_cell_chars: 10,
    max_sql_chars: 65536,
    offset_warning: 100,
  };

  it('passes through result within budgets with no warnings', () => {
    const exec: ExecResult = {
      fields: [
        { name: 'id', dataTypeId: 23, typeName: 'int4' },
        { name: 'name', dataTypeId: 25, typeName: 'text' },
      ],
      rows: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
      durationMs: 15,
      truncatedByRowCap: false,
    };

    const out = applyBudgets(exec, defaultBudgets, { requestId: 'req-001' });
    expect('result' in out).toBe(true);
    if (!('result' in out)) return;

    expect(out.result.row_count).toBe(2);
    expect(out.result.truncated).toBe(false);
    expect(out.result.warnings).toHaveLength(0);
    expect(out.result.columns).toEqual([
      { name: 'id', type: 'int4', untrusted: false },
      { name: 'name', type: 'text', untrusted: false },
    ]);
  });

  it('preserves untrusted and sensitive column flags', () => {
    const exec: ExecResult = {
      fields: [
        { name: 'id', dataTypeId: 23, typeName: 'int4' },
        { name: 'feedback', dataTypeId: 25, typeName: 'text' },
        { name: 'ssn', dataTypeId: 25, typeName: 'text' },
      ],
      rows: [{ id: 1, feedback: 'good', ssn: '123' }],
      durationMs: 5,
      truncatedByRowCap: false,
    };

    const out = applyBudgets(exec, defaultBudgets, {
      requestId: 'req-002',
      untrustedColumns: ['feedback'],
      sensitiveColumns: ['ssn'],
    });

    expect('result' in out).toBe(true);
    if (!('result' in out)) return;

    const cols = out.result.columns;
    expect(cols.find((c) => c.name === 'feedback')?.untrusted).toBe(true);
    expect(cols.find((c) => c.name === 'ssn')?.masked).toBe(true);
  });

  it('applies all budgets in exact deterministic order: PGM-301 -> PGM-304 -> PGM-307 -> PGM-306', () => {
    // 7 rows (exceeds max_rows: 5)
    // 4 columns (exceeds max_columns: 3; columns: alpha, beta, charlie, delta)
    // Cells with > 10 chars (exceeds max_cell_chars: 10)
    // Offset: 500 (exceeds offset_warning: 100)
    const exec: ExecResult = {
      fields: [
        { name: 'delta', dataTypeId: 25, typeName: 'text' },
        { name: 'alpha', dataTypeId: 25, typeName: 'text' },
        { name: 'beta', dataTypeId: 25, typeName: 'text' },
        { name: 'charlie', dataTypeId: 25, typeName: 'text' },
      ],
      rows: Array.from({ length: 7 }, (_, i) => ({
        delta: `delta_value_${i}_extra_long_string`,
        alpha: `alpha_${i}_super_long_content`,
        beta: `beta_${i}`,
        charlie: `charlie_${i}`,
      })),
      durationMs: 25,
      truncatedByRowCap: true,
    };

    const out = applyBudgets(exec, defaultBudgets, {
      requestId: 'req-003',
      offset: 500,
    });

    expect('result' in out).toBe(true);
    if (!('result' in out)) return;

    // Check rows cut to max_rows (5)
    expect(out.result.row_count).toBe(5);
    expect(out.result.truncated).toBe(true);

    // Check columns pruned alphabetically to 3: alpha, beta, charlie (delta dropped)
    expect(out.result.columns.map((c) => c.name)).toEqual(['alpha', 'beta', 'charlie']);
    expect(out.result.rows[0]?.delta).toBeUndefined();

    // Check cell truncation on kept alpha
    expect(String(out.result.rows[0]?.alpha)).toContain('... [');

    // Check exact warning sequence
    const warningCodes = out.result.warnings.map((w) => w.code);
    expect(warningCodes).toEqual(['PGM-301', 'PGM-304', 'PGM-307', 'PGM-306']);
  });

  it('refuses with PGM-305 if payload exceeds max_payload_bytes', () => {
    const tightBudgets = {
      ...defaultBudgets,
      max_payload_bytes: 200, // Very tight limit
    };

    const exec: ExecResult = {
      fields: [{ name: 'msg', dataTypeId: 25, typeName: 'text' }],
      rows: [
        { msg: 'This is a long message that will comfortably exceed two hundred bytes when packaged into JSON format.' },
        { msg: 'Another long message adding more serialized weight to the payload response.' },
      ],
      durationMs: 10,
      truncatedByRowCap: false,
    };

    const out = applyBudgets(exec, tightBudgets, { requestId: 'req-004' });
    expect('refused' in out).toBe(true);
    if (!('refused' in out)) return;

    expect(out.refused.code).toBe('PGM-305');
    expect(out.refused.kind).toBe('refused');
    expect(out.refused.message).toContain('exceeds maximum allowed payload');
  });

  it('measures multi-byte characters accurately by bytes in payload budget check', () => {
    const multibyteBudgets = {
      ...defaultBudgets,
      max_payload_bytes: 350,
    };

    // 4-byte emojis repeat
    const exec: ExecResult = {
      fields: [{ name: 'emojis', dataTypeId: 25, typeName: 'text' }],
      rows: [
        { emojis: '🎉'.repeat(30) }, // 30 emojis * 4 bytes = 120 bytes
        { emojis: '🚀'.repeat(30) }, // 120 bytes
        { emojis: '🔥'.repeat(30) }, // 120 bytes -> total > 360 bytes
      ],
      durationMs: 5,
      truncatedByRowCap: false,
    };

    const out = applyBudgets(exec, multibyteBudgets, { requestId: 'req-005' });
    expect('refused' in out).toBe(true);
    if (!('refused' in out)) return;

    expect(out.refused.code).toBe('PGM-305');
  });
});

