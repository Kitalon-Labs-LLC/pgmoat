import { describe, it, expect } from 'vitest';
import { PGMOAT_VERSION } from '../../src/version.js';

describe('smoke', () => {
  it('exports PGMOAT_VERSION as a string', () => {
    expect(PGMOAT_VERSION).toBeTypeOf('string');
    expect(PGMOAT_VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });
});
