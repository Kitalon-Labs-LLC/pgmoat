import { describe, it, expect } from 'vitest';
import { truncateCellString, applyCellBudget } from '../../../src/budgets/cells.js';

describe('truncateCellString', () => {
  it('does not truncate strings at or below limit', () => {
    expect(truncateCellString('hello', 5)).toEqual({ text: 'hello', truncated: false });
    expect(truncateCellString('hi', 5)).toEqual({ text: 'hi', truncated: false });
  });

  it('truncates strings exceeding limit appending [+N chars]', () => {
    const str = 'abcdefghij'; // 10 chars
    const res = truncateCellString(str, 4);
    expect(res.truncated).toBe(true);
    expect(res.text).toBe('abcd... [+6 chars]');
  });
});

describe('applyCellBudget', () => {
  it('leaves rows untouched when cells are within budget', () => {
    const rows = [
      { id: 1, name: 'Alice', bio: 'Short bio' },
      { id: 2, name: 'Bob', bio: 'Another short' },
    ];
    const res = applyCellBudget(rows, 50);
    expect(res.truncatedCount).toBe(0);
    expect(res.rows).toEqual(rows);
  });

  it('truncates long strings and accurately counts shortened cells', () => {
    const rows = [
      { id: 1, longField1: '123456789012345', shortField: 'abc' },
      { id: 2, longField1: '123456789012345', longField2: 'abcdefghijk' },
    ];
    // limit 10 chars
    const res = applyCellBudget(rows, 10);
    expect(res.truncatedCount).toBe(3);
    expect(res.rows[0]?.longField1).toBe('1234567890... [+5 chars]');
    expect(res.rows[0]?.shortField).toBe('abc');
    expect(res.rows[1]?.longField2).toBe('abcdefghij... [+1 chars]');
  });

  it('preserves non-string cell values without error', () => {
    const rows = [
      { id: 100, active: true, score: 99.5, empty: null },
    ];
    const res = applyCellBudget(rows, 10);
    expect(res.truncatedCount).toBe(0);
    expect(res.rows[0]).toEqual({ id: 100, active: true, score: 99.5, empty: null });
  });
});
