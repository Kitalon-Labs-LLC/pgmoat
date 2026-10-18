import { describe, it, expect } from 'vitest';
import { parseSql } from '../../../src/safety/parse.js';
import { fingerprint } from '../../../src/safety/fingerprint.js';

describe('Constant-stripped SQL fingerprint (P2.8)', () => {
  it('returns a 16-character lowercase hex string', async () => {
    const { tree } = await parseSql('SELECT id FROM users WHERE id = 1');
    const fp = await fingerprint(tree);

    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it('produces identical fingerprint when literals differ', async () => {
    const { tree: t1 } = await parseSql('SELECT id, name FROM users WHERE id = 42 AND status = \'active\'');
    const { tree: t2 } = await parseSql('SELECT id, name FROM users WHERE id = 999 AND status = \'pending\'');

    const fp1 = await fingerprint(t1);
    const fp2 = await fingerprint(t2);

    expect(fp1).toBe(fp2);
  });

  it('produces identical fingerprint when whitespace and casing of keywords differ', async () => {
    const { tree: t1 } = await parseSql('SELECT id FROM users WHERE id = 1');
    const { tree: t2 } = await parseSql(`
      select
        id
      from
        users
      where
        id   =   1
    `);

    const fp1 = await fingerprint(t1);
    const fp2 = await fingerprint(t2);

    expect(fp1).toBe(fp2);
  });

  it('produces different fingerprint when column names differ', async () => {
    const { tree: t1 } = await parseSql('SELECT id FROM users WHERE id = 1');
    const { tree: t2 } = await parseSql('SELECT email FROM users WHERE id = 1');

    const fp1 = await fingerprint(t1);
    const fp2 = await fingerprint(t2);

    expect(fp1).not.toBe(fp2);
  });

  it('produces different fingerprint when table names differ', async () => {
    const { tree: t1 } = await parseSql('SELECT id FROM users WHERE id = 1');
    const { tree: t2 } = await parseSql('SELECT id FROM accounts WHERE id = 1');

    const fp1 = await fingerprint(t1);
    const fp2 = await fingerprint(t2);

    expect(fp1).not.toBe(fp2);
  });

  it('produces different fingerprints for IN lists of different lengths (documented behavior)', async () => {
    // Note: IN lists with differing number of arguments represent structurally distinct ASTs
    // with different numbers of placeholder constants (e.g. IN ('?', '?') vs IN ('?', '?', '?')).
    // This is documented and intended behavior.
    const { tree: t1 } = await parseSql('SELECT id FROM users WHERE id IN (1, 2)');
    const { tree: t2 } = await parseSql('SELECT id FROM users WHERE id IN (1, 2, 3)');

    const fp1 = await fingerprint(t1);
    const fp2 = await fingerprint(t2);

    expect(fp1).not.toBe(fp2);

    // But identical length IN lists with different literals share the same fingerprint
    const { tree: t3 } = await parseSql('SELECT id FROM users WHERE id IN (100, 200, 300)');
    const fp3 = await fingerprint(t3);
    expect(fp3).toBe(fp2);
  });

  it('produces deterministic fingerprints for EXPLAIN and SHOW statements', async () => {
    const { tree: t1 } = await parseSql('SHOW work_mem');
    const { tree: t2 } = await parseSql('show   work_mem');

    const fp1 = await fingerprint(t1);
    const fp2 = await fingerprint(t2);
    expect(fp1).toBe(fp2);

    const { tree: exp1 } = await parseSql('EXPLAIN SELECT id FROM users WHERE id = 10');
    const { tree: exp2 } = await parseSql('EXPLAIN SELECT id FROM users WHERE id = 20');
    const fpExp1 = await fingerprint(exp1);
    const fpExp2 = await fingerprint(exp2);
    expect(fpExp1).toBe(fpExp2);
  });
});

