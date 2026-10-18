import { describe, it, expect, vi, afterEach } from 'vitest';
import * as libpgQuery from 'libpg-query';
import { parseSql, warmParser } from '../../../src/safety/parse.js';
import { PgmoatError } from '../../../src/errors.js';

describe('parseSql', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warms parser successfully', async () => {
    await expect(warmParser()).resolves.toBeUndefined();
  });

  it('parses a simple select statement and returns tree with grammarVersion', async () => {
    const result = await parseSql('SELECT 1');
    expect(result.grammarVersion).toBeGreaterThanOrEqual(180004);
    expect(result.tree.stmts).toHaveLength(1);
    expect(result.tree.stmts?.[0]?.stmt).toBeDefined();
  });

  it('produces two entries for two statements without refusing here', async () => {
    const result = await parseSql('SELECT 1; SELECT 2;');
    expect(result.tree.stmts).toHaveLength(2);
  });

  it('syntax error yields PGM-206 with position in message', async () => {
    try {
      await parseSql('SELECT FROM WHERE');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PgmoatError);
      const pgErr = err as PgmoatError;
      expect(pgErr.code).toBe('PGM-206');
      expect(pgErr.message).toMatch(/position \d+/);
    }
  });

  it('empty string yields PGM-206', async () => {
    try {
      await parseSql('   ');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PgmoatError);
      const pgErr = err as PgmoatError;
      expect(pgErr.code).toBe('PGM-206');
    }
  });

  it('comment-only yields PGM-206', async () => {
    try {
      await parseSql('-- only a comment\n/* block comment */');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PgmoatError);
      const pgErr = err as PgmoatError;
      expect(pgErr.code).toBe('PGM-206');
      expect(pgErr.message).toContain('no statements');
    }
  });

  it('over-length yields PGM-206 without calling the parser (spy)', async () => {
    const parseSpy = vi.spyOn(libpgQuery, 'parse');
    const maxSqlChars = 20;
    const longSql = 'SELECT * FROM very_long_table_name_that_exceeds_budget';

    try {
      await parseSql(longSql, { maxSqlChars });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PgmoatError);
      const pgErr = err as PgmoatError;
      expect(pgErr.code).toBe('PGM-206');
      expect(pgErr.message).toContain('exceeds maximum allowed');
      expect(parseSpy).not.toHaveBeenCalled();
    }
  });
});
