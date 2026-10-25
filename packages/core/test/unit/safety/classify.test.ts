import { describe, it, expect } from 'vitest';
import { parseSql } from '../../../src/safety/parse.js';
import { classify } from '../../../src/safety/classify.js';
import type { ParseResult } from '@pgsql/types';

describe('Statement classification (classify.ts)', () => {
  async function testClassify(sql: string) {
    const parsed = await parseSql(sql);
    return classify(parsed.tree);
  }

  // --- Allowed statements ---
  describe('allowed statements', () => {
    it('allows simple SELECT', async () => {
      const res = await testClassify('SELECT 1');
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.statementType).toBe('select');
    });

    it('allows complex SELECT with JOIN, WHERE, GROUP BY, ORDER BY', async () => {
      const res = await testClassify(
        'SELECT u.id, count(o.id) FROM users u LEFT JOIN orders o ON o.user_id = u.id WHERE u.active = true GROUP BY u.id ORDER BY count(o.id) DESC',
      );
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.statementType).toBe('select');
    });

    it('allows SELECT with UNION ALL', async () => {
      const res = await testClassify('SELECT 1 UNION ALL SELECT 2');
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.statementType).toBe('select');
    });

    it('allows SELECT with read-only CTE', async () => {
      const res = await testClassify(
        'WITH cte AS (SELECT 1 AS n) SELECT * FROM cte',
      );
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.statementType).toBe('select');
    });

    it('allows SHOW work_mem', async () => {
      const res = await testClassify('SHOW work_mem');
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.statementType).toBe('show');
    });

    it('allows EXPLAIN SELECT 1', async () => {
      const res = await testClassify('EXPLAIN SELECT 1');
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.statementType).toBe('explain');
    });

    it('allows EXPLAIN (ANALYZE false) SELECT 1', async () => {
      const res = await testClassify('EXPLAIN (ANALYZE false) SELECT 1');
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.statementType).toBe('explain');
    });

    it('allows EXPLAIN (COSTS off, VERBOSE true) SELECT 1', async () => {
      const res = await testClassify(
        'EXPLAIN (COSTS off, VERBOSE true) SELECT 1',
      );
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.statementType).toBe('explain');
    });
  });

  // --- Statement count (PGM-204) ---
  describe('statement count (PGM-204)', () => {
    it('refuses multiple SELECT statements (SELECT 1; SELECT 2)', async () => {
      const res = await testClassify('SELECT 1; SELECT 2;');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('PGM-204');
        expect(res.message).toContain('Expected exactly 1 statement');
      }
    });

    it('refuses COMMIT; DROP SCHEMA public CASCADE', async () => {
      const res = await testClassify('COMMIT; DROP SCHEMA public CASCADE');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-204');
    });

    it('refuses empty statement list', () => {
      const emptyTree: ParseResult = { version: 180004, stmts: [] };
      const res = classify(emptyTree);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-204');
    });
  });

  // --- EXPLAIN ANALYZE (PGM-209) ---
  describe('EXPLAIN ANALYZE (PGM-209)', () => {
    it('refuses EXPLAIN ANALYZE SELECT 1', async () => {
      const res = await testClassify('EXPLAIN ANALYZE SELECT 1');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('PGM-209');
        expect(res.message).toContain('EXPLAIN ANALYZE is not allowed');
      }
    });

    it('refuses EXPLAIN (ANALYZE) SELECT 1', async () => {
      const res = await testClassify('EXPLAIN (ANALYZE) SELECT 1');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-209');
    });

    it('refuses EXPLAIN (ANALYZE true) SELECT 1', async () => {
      const res = await testClassify('EXPLAIN (ANALYZE true) SELECT 1');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-209');
    });
  });

  // --- SELECT INTO and Locking clauses (PGM-202) ---
  describe('SELECT INTO and locking clauses (PGM-202)', () => {
    it('refuses SELECT * INTO t FROM x', async () => {
      const res = await testClassify('SELECT * INTO t FROM x');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('PGM-202');
        expect(res.message).toContain('SELECT INTO is not allowed');
      }
    });

    it('refuses SELECT FOR UPDATE', async () => {
      const res = await testClassify('SELECT * FROM users FOR UPDATE');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('PGM-202');
        expect(res.message).toContain('locking clauses');
      }
    });

    it('refuses SELECT FOR NO KEY UPDATE', async () => {
      const res = await testClassify('SELECT * FROM users FOR NO KEY UPDATE');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-202');
    });

    it('refuses SELECT FOR SHARE', async () => {
      const res = await testClassify('SELECT * FROM users FOR SHARE');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-202');
    });

    it('refuses SELECT FOR KEY SHARE', async () => {
      const res = await testClassify('SELECT * FROM users FOR KEY SHARE');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-202');
    });
  });

  // --- Writing CTEs (PGM-203) ---
  describe('writing CTEs (PGM-203)', () => {
    it('refuses writing CTE with DELETE', async () => {
      const res = await testClassify(
        'WITH d AS (DELETE FROM users WHERE id = 1 RETURNING *) SELECT * FROM d',
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('PGM-203');
        expect(res.message).toContain(
          'Data-modifying statement "DeleteStmt" is not allowed inside a CommonTableExpr',
        );
      }
    });

    it('refuses writing CTE with INSERT', async () => {
      const res = await testClassify(
        'WITH ins AS (INSERT INTO users (id) VALUES (1) RETURNING *) SELECT * FROM ins',
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-203');
    });

    it('refuses writing CTE with UPDATE', async () => {
      const res = await testClassify(
        'WITH u AS (UPDATE users SET active = false RETURNING *) SELECT * FROM u',
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-203');
    });

    it('refuses nested writing CTE', async () => {
      const res = await testClassify(
        'WITH outer_cte AS (WITH inner_cte AS (DELETE FROM users RETURNING *) SELECT * FROM inner_cte) SELECT * FROM outer_cte',
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-203');
    });
  });

  // --- Forbidden top-level and inner statement families (PGM-201) ---
  describe('forbidden statements (PGM-201)', () => {
    it('refuses INSERT', async () => {
      const res = await testClassify('INSERT INTO users VALUES (1)');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses UPDATE', async () => {
      const res = await testClassify('UPDATE users SET name = "test"');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses DELETE', async () => {
      const res = await testClassify('DELETE FROM users');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses MERGE', async () => {
      const res = await testClassify(
        'MERGE INTO target t USING source s ON t.id = s.id WHEN MATCHED THEN DELETE',
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses COPY', async () => {
      const res = await testClassify('COPY users TO stdout');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses TRANSACTION (BEGIN)', async () => {
      const res = await testClassify('BEGIN');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses SET (VariableSetStmt)', async () => {
      const res = await testClassify("SET work_mem = '1GB'");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses LOCK', async () => {
      const res = await testClassify('LOCK TABLE users IN EXCLUSIVE MODE');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses NOTIFY', async () => {
      const res = await testClassify("NOTIFY channel, 'msg'");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses LISTEN', async () => {
      const res = await testClassify('LISTEN channel');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses UNLISTEN', async () => {
      const res = await testClassify('UNLISTEN *');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses CREATE TABLE', async () => {
      const res = await testClassify('CREATE TABLE t (id int)');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses CREATE INDEX', async () => {
      const res = await testClassify('CREATE INDEX idx ON users (id)');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses CREATE VIEW', async () => {
      const res = await testClassify('CREATE VIEW v AS SELECT 1');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses ALTER TABLE', async () => {
      const res = await testClassify('ALTER TABLE users ADD COLUMN c int');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses DROP TABLE', async () => {
      const res = await testClassify('DROP TABLE users');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses DROP SCHEMA', async () => {
      const res = await testClassify('DROP SCHEMA public CASCADE');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses GRANT', async () => {
      const res = await testClassify('GRANT SELECT ON users TO app_role');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses REVOKE', async () => {
      const res = await testClassify('REVOKE ALL ON users FROM app_role');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses TRUNCATE', async () => {
      const res = await testClassify('TRUNCATE users');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses COMMENT ON', async () => {
      const res = await testClassify("COMMENT ON TABLE users IS 'User table'");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses DO block', async () => {
      const res = await testClassify('DO $$ BEGIN NULL; END $$');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses CALL procedure', async () => {
      const res = await testClassify('CALL my_procedure()');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses PREPARE', async () => {
      const res = await testClassify('PREPARE p AS SELECT 1');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses EXECUTE', async () => {
      const res = await testClassify('EXECUTE p');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses DEALLOCATE', async () => {
      const res = await testClassify('DEALLOCATE p');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses VACUUM', async () => {
      const res = await testClassify('VACUUM users');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses REINDEX', async () => {
      const res = await testClassify('REINDEX TABLE users');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses CLUSTER', async () => {
      const res = await testClassify('CLUSTER users USING users_pkey');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses REFRESH MATERIALIZED VIEW', async () => {
      const res = await testClassify('REFRESH MATERIALIZED VIEW mv');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses CHECKPOINT', async () => {
      const res = await testClassify('CHECKPOINT');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses DISCARD ALL', async () => {
      const res = await testClassify('DISCARD ALL');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-201');
    });

    it('refuses EXPLAIN DELETE FROM t (inner forbidden statement)', async () => {
      const res = await testClassify('EXPLAIN DELETE FROM users');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('PGM-201');
        expect(res.message).toContain('DeleteStmt');
      }
    });

    it('refuses unknown injected node type (fail-closed allow-list)', () => {
      // Inject a fake unknown node
      const fakeNodeTree: ParseResult = {
        version: 180004,
        stmts: [
          {
            stmt: {
              SelectStmt: {
                targetList: [
                  {
                    CustomFakeNode: {
                      foo: 'bar',
                    },
                  } as unknown as Record<string, unknown>,
                ],
                op: 'SETOP_NONE',
              },
            },
          },
        ],
      };
      const res = classify(fakeNodeTree);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('PGM-201');
        expect(res.message).toContain(
          'Unknown or disallowed AST node type: "CustomFakeNode"',
        );
      }
    });
  });
});
