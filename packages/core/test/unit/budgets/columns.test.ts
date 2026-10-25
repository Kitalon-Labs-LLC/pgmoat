import { describe, it, expect } from 'vitest';
import { applyColumnBudget } from '../../../src/budgets/columns.js';

describe('applyColumnBudget', () => {
  const fields = [
    { name: 'id', type: 'int4' },
    { name: 'zeta', type: 'text' },
    { name: 'alpha', type: 'text' },
    { name: 'beta', type: 'text' },
  ];

  const rows = [
    { id: 1, zeta: 'z1', alpha: 'a1', beta: 'b1' },
    { id: 2, zeta: 'z2', alpha: 'a2', beta: 'b2' },
  ];

  it('keeps all columns when count is below or equal to maxColumns', () => {
    const res = applyColumnBudget(fields, rows, 4);
    expect(res.truncated).toBe(false);
    expect(res.fields.map((f) => f.name)).toEqual(['id', 'zeta', 'alpha', 'beta']);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toEqual({ id: 1, zeta: 'z1', alpha: 'a1', beta: 'b1' });
  });

  it('truncates columns keeping the first maxColumns alphabetically', () => {
    // Alphabetical order: alpha, beta, id, zeta
    // With maxColumns = 2, keeps alpha, beta
    const res = applyColumnBudget(fields, rows, 2);
    expect(res.truncated).toBe(true);
    expect(res.totalColumns).toBe(4);
    expect(res.keptColumns).toBe(2);
    expect(res.fields.map((f) => f.name)).toEqual(['alpha', 'beta']);
    expect(res.rows[0]).toEqual({ alpha: 'a1', beta: 'b1' });
    expect(res.rows[1]).toEqual({ alpha: 'a2', beta: 'b2' });
  });

  it('handles empty fields and rows gracefully', () => {
    const res = applyColumnBudget([], [], 10);
    expect(res.truncated).toBe(false);
    expect(res.fields).toEqual([]);
    expect(res.rows).toEqual([]);
  });
});

