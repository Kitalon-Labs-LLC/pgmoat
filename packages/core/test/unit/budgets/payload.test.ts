import { describe, it, expect } from 'vitest';
import { measurePayloadBytes, checkPayloadBudget } from '../../../src/budgets/payload.js';

describe('measurePayloadBytes', () => {
  it('measures ASCII payloads correctly', () => {
    const data = { msg: 'hello' };
    const bytes = measurePayloadBytes(data);
    expect(bytes).toBe(Buffer.byteLength(JSON.stringify(data), 'utf-8'));
  });

  it('measures multi-byte UTF-8 characters accurately by byte length', () => {
    // '€' is 3 bytes in UTF-8, '😊' is 4 bytes
    const data = { symbol: '€', emoji: '😊' };
    const json = JSON.stringify(data);
    const charLen = json.length;
    const byteLen = Buffer.byteLength(json, 'utf-8');

    expect(byteLen).toBeGreaterThan(charLen);
    expect(measurePayloadBytes(data)).toBe(byteLen);
  });
});

describe('checkPayloadBudget', () => {
  it('returns null error when payload is within budget', () => {
    const candidate = { id: 1, name: 'ok' };
    const res = checkPayloadBudget(candidate, 1000);
    expect(res.error).toBeNull();
    expect(res.bytes).toBeGreaterThan(0);
  });

  it('returns PGM-305 refusal error when payload exceeds budget', () => {
    const candidate = { data: 'A'.repeat(500) };
    const res = checkPayloadBudget(candidate, 200);
    expect(res.error).not.toBeNull();
    expect(res.error?.code).toBe('PGM-305');
    expect(res.error?.kind).toBe('refused');
    expect(res.error?.message).toContain('exceeds maximum allowed payload');
  });
});
