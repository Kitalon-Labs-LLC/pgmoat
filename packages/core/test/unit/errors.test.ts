import { describe, it, expect } from 'vitest';
import {
  ERROR_CODES,
  PgmoatError,
  isPgmoatError,
  refuse,
  fail,
  docsUrl,
  type ErrorCode,
} from '../../src/errors.js';

describe('error registry and PgmoatError', () => {
  it('contains expected critical error codes', () => {
    const criticalCodes: ErrorCode[] = [
      'PGM-001',
      'PGM-111',
      'PGM-204',
      'PGM-208',
      'PGM-303',
      'PGM-405',
      'PGM-601',
      'PGM-705',
    ];

    for (const code of criticalCodes) {
      expect(ERROR_CODES[code]).toBeDefined();
      expect(ERROR_CODES[code].code).toBe(code);
      expect(ERROR_CODES[code].title.length).toBeGreaterThan(0);
    }
  });

  it('ensures every code matches PGM-ddd format', () => {
    const allCodes = Object.keys(ERROR_CODES);
    expect(allCodes.length).toBe(68);

    for (const code of allCodes) {
      expect(code).toMatch(/^PGM-\d{3}$/);
      expect(ERROR_CODES[code as ErrorCode].code).toBe(code);
    }
  });

  it('creates PgmoatError carrying code, kind, hint, and docsUrl', () => {
    const err = new PgmoatError(
      'PGM-204',
      'Multiple statements are not permitted',
      'refused',
      'Send one statement per call',
    );

    expect(err.name).toBe('PgmoatError');
    expect(err.code).toBe('PGM-204');
    expect(err.kind).toBe('refused');
    expect(err.hint).toBe('Send one statement per call');
    expect(err.docsUrl).toBe('https://pgmoat.dev/docs/errors/PGM-204');
    expect(err.message).toBe('Multiple statements are not permitted');
    expect(isPgmoatError(err)).toBe(true);
    expect(isPgmoatError(new Error('other'))).toBe(false);
  });

  it('refuse helper populates default hint from registry if not provided', () => {
    const err = refuse('PGM-201', 'Write statements forbidden');
    expect(err.kind).toBe('refused');
    expect(err.hint).toBe('Use SELECT to read data');
    expect(err.code).toBe('PGM-201');
  });

  it('fail helper sets kind to error', () => {
    const err = fail('PGM-503', 'Connection pool exhausted');
    expect(err.kind).toBe('error');
    expect(err.code).toBe('PGM-503');
    expect(err.docsUrl).toBe(docsUrl('PGM-503'));
  });
});
