import { describe, it, expect } from 'vitest';
import { parseSql } from '../../../src/safety/parse.js';
import { rewrite } from '../../../src/safety/rewrite.js';
import { createPolicyIndex } from '../../fixtures/policy-index.js';

describe('AST LIMIT rewrite and invariant re-check (P2.7)', () => {
  it('injects LIMIT maxRows + 1 when no limit is present', async () => {
    const { tree } = await parseSql('SELECT id, name FROM users WHERE id = 1');
    const result = await rewrite(tree, {
      maxRows: 100,
      originalSql: 'SELECT id, name FROM users WHERE id = 1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.limitInjected).toBe(true);
    expect(result.sql).toMatch(/LIMIT 101/);
  });

  it('keeps small constant limit unchanged', async () => {
    const { tree } = await parseSql('SELECT id FROM users LIMIT 10');
    const result = await rewrite(tree, {
      maxRows: 100,
      originalSql: 'SELECT id FROM users LIMIT 10',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.limitInjected).toBe(false);
    expect(result.sql).toMatch(/LIMIT 10/);
  });

  it('refuses constant limit greater than maxRows with PGM-302', async () => {
    const { tree } = await parseSql('SELECT id FROM users LIMIT 500');
    const result = await rewrite(tree, {
      maxRows: 100,
      originalSql: 'SELECT id FROM users LIMIT 500',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('PGM-302');
    expect(result.message).toBe("LIMIT 500 is above this server's limit of 100 rows.");
  });

  it('allows constant limit exactly equal to maxRows', async () => {
    const { tree } = await parseSql('SELECT id FROM users LIMIT 100');
    const result = await rewrite(tree, {
      maxRows: 100,
      originalSql: 'SELECT id FROM users LIMIT 100',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.limitInjected).toBe(false);
    expect(result.sql).toMatch(/LIMIT 100/);
  });

  it('keeps non-constant parameter limit without injection', async () => {
    const { tree } = await parseSql('SELECT id FROM users LIMIT $1');
    const result = await rewrite(tree, {
      maxRows: 100,
      originalSql: 'SELECT id FROM users LIMIT $1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.limitInjected).toBe(false);
    expect(result.sql).toMatch(/LIMIT \$1/);
  });

  it('keeps non-constant expression limit without injection', async () => {
    const { tree } = await parseSql('SELECT id FROM users LIMIT (SELECT 5)');
    const result = await rewrite(tree, {
      maxRows: 100,
      originalSql: 'SELECT id FROM users LIMIT (SELECT 5)',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.limitInjected).toBe(false);
  });

  it('treats FETCH FIRST 5 ROWS ONLY as LIMIT and keeps it when <= maxRows', async () => {
    const { tree } = await parseSql('SELECT id FROM users FETCH FIRST 5 ROWS ONLY');
    const result = await rewrite(tree, {
      maxRows: 100,
      originalSql: 'SELECT id FROM users FETCH FIRST 5 ROWS ONLY',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.limitInjected).toBe(false);
    expect(result.sql).toMatch(/LIMIT 5/);
  });

  it('refuses FETCH FIRST 500 ROWS ONLY when > maxRows with PGM-302', async () => {
    const { tree } = await parseSql('SELECT id FROM users FETCH FIRST 500 ROWS ONLY');
    const result = await rewrite(tree, {
      maxRows: 100,
      originalSql: 'SELECT id FROM users FETCH FIRST 500 ROWS ONLY',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('PGM-302');
    expect(result.message).toBe("LIMIT 500 is above this server's limit of 100 rows.");
  });

  it('applies one outer LIMIT to UNION query without outer limit', async () => {
    const { tree } = await parseSql('SELECT 1 UNION SELECT 2');
    const result = await rewrite(tree, {
      maxRows: 100,
      originalSql: 'SELECT 1 UNION SELECT 2',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.limitInjected).toBe(true);
    expect(result.sql).toMatch(/LIMIT 101/);
  });

  it('preserves inner limits and injects outer LIMIT on UNION', async () => {
    const { tree } = await parseSql('(SELECT id FROM users LIMIT 5) UNION (SELECT id FROM admins LIMIT 10)');
    const result = await rewrite(tree, {
      maxRows: 50,
      originalSql: '(SELECT id FROM users LIMIT 5) UNION (SELECT id FROM admins LIMIT 10)',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.limitInjected).toBe(true);
    expect(result.sql).toMatch(/LIMIT 51/);
  });

  it('leaves LIMIT_OPTION_WITH_TIES unchanged without injection', async () => {
    const sql = 'SELECT id FROM users ORDER BY id FETCH FIRST 10 ROWS WITH TIES';
    const { tree } = await parseSql(sql);
    const result = await rewrite(tree, {
      maxRows: 50,
      originalSql: sql,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.limitInjected).toBe(false);
    expect(result.sql).toBe(sql);
  });

  it('does not rewrite ExplainStmt and returns original SQL', async () => {
    const sql = 'EXPLAIN SELECT id FROM users';
    const { tree } = await parseSql(sql);
    const result = await rewrite(tree, {
      maxRows: 50,
      originalSql: sql,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.limitInjected).toBe(false);
    expect(result.sql).toBe(sql);
  });

  it('does not rewrite VariableShowStmt and returns original SQL', async () => {
    const sql = 'SHOW work_mem';
    const { tree } = await parseSql(sql);
    const result = await rewrite(tree, {
      maxRows: 50,
      originalSql: sql,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.limitInjected).toBe(false);
    expect(result.sql).toBe(sql);
  });

  it('yields PGM-210 when forced deparser mismatch changes query semantics', async () => {
    const { tree } = await parseSql('SELECT id FROM users');
    const mockDeparse = async () => 'SELECT email FROM users LIMIT 101';

    const result = await rewrite(tree, {
      maxRows: 100,
      originalSql: 'SELECT id FROM users',
      deparse: mockDeparse,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('PGM-210');
    expect(result.message).toBe('Internal safety invariant failed after rewrite. Report a bug; the query was not run');
    expect(result.internalLog).toBeDefined();
  });

  it('yields PGM-210 when forced deparser introduces syntax error', async () => {
    const { tree } = await parseSql('SELECT id FROM users');
    const mockDeparse = async () => 'SELEC MALFORMED SQL SYNTAX !!!';

    const result = await rewrite(tree, {
      maxRows: 100,
      originalSql: 'SELECT id FROM users',
      deparse: mockDeparse,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('PGM-210');
  });

  it('yields PGM-210 when forced deparser turns query into forbidden statement', async () => {
    const { tree } = await parseSql('SELECT id FROM users');
    const mockDeparse = async () => 'DROP TABLE users';

    const result = await rewrite(tree, {
      maxRows: 100,
      originalSql: 'SELECT id FROM users',
      deparse: mockDeparse,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('PGM-210');
  });

  it('enforces policy relations in invariant check when policyIndex is provided', async () => {
    const index = createPolicyIndex({
      knownRelations: ['public.users'],
      exposedSchemas: ['public'],
    });

    const { tree } = await parseSql('SELECT id FROM users');
    // Mock deparse changes table to secret_table
    const mockDeparse = async () => 'SELECT id FROM secret_table LIMIT 101';

    const result = await rewrite(tree, {
      maxRows: 100,
      originalSql: 'SELECT id FROM users',
      policyIndex: index,
      deparse: mockDeparse,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('PGM-210');
  });

  it('enforces policy columns in invariant check when policyIndex is provided', async () => {
    const index = createPolicyIndex({
      knownRelations: ['public.users'],
      exposedSchemas: ['public'],
      hiddenColumns: { 'public.users': ['password_hash'] },
    });

    const { tree } = await parseSql('SELECT id FROM users');
    // Mock deparse introduces hidden column
    const mockDeparse = async () => 'SELECT password_hash FROM users LIMIT 101';

    const result = await rewrite(tree, {
      maxRows: 100,
      originalSql: 'SELECT id FROM users',
      policyIndex: index,
      deparse: mockDeparse,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('PGM-210');
  });

  describe('50 allowed queries round trip preserves semantics through deparser', () => {
    const allowedQueries = [
      'SELECT 1',
      'SELECT id, name FROM users',
      'SELECT id, name FROM users WHERE id = 1',
      'SELECT id, name FROM users WHERE id = 1 AND active = true',
      'SELECT id, name FROM users WHERE id = 1 OR id = 2',
      'SELECT id, name FROM users WHERE NOT (active = false)',
      'SELECT id FROM users WHERE id IN (1, 2, 3)',
      'SELECT id FROM users WHERE name LIKE \'%smith%\'',
      'SELECT id FROM users WHERE name ILIKE \'admin%\'',
      'SELECT id FROM users WHERE description IS NULL',
      'SELECT id FROM users WHERE description IS NOT NULL',
      'SELECT id FROM users WHERE age BETWEEN 18 AND 65',
      'SELECT u.id, o.amount FROM users u JOIN orders o ON u.id = o.user_id',
      'SELECT u.id, o.amount FROM users u LEFT JOIN orders o ON u.id = o.user_id',
      'SELECT u.id, o.amount FROM users u RIGHT JOIN orders o ON u.id = o.user_id',
      'SELECT u.id, o.amount FROM users u FULL JOIN orders o ON u.id = o.user_id',
      'SELECT u.id, o.amount FROM users u CROSS JOIN orders o',
      'SELECT count(*) FROM users',
      'SELECT department_id, count(*), avg(salary) FROM employees GROUP BY department_id',
      'SELECT department_id, count(*) FROM employees GROUP BY department_id HAVING count(*) > 5',
      'SELECT DISTINCT department_id FROM employees',
      'SELECT DISTINCT ON (department_id) id, salary FROM employees ORDER BY department_id, salary DESC',
      'SELECT id, rank() OVER (PARTITION BY department_id ORDER BY salary DESC) FROM employees',
      'SELECT id, row_number() OVER (ORDER BY id) FROM users',
      'SELECT id, dense_rank() OVER (ORDER BY salary) FROM employees',
      'SELECT id, sum(salary) OVER () FROM employees',
      'WITH dept_avg AS (SELECT department_id, avg(salary) AS avgsal FROM employees GROUP BY department_id) SELECT * FROM dept_avg',
      'WITH regional AS (SELECT id, region FROM users), high_earners AS (SELECT id FROM employees WHERE salary > 100000) SELECT * FROM regional',
      'SELECT 1 UNION SELECT 2',
      'SELECT 1 UNION ALL SELECT 2',
      'SELECT id FROM users INTERSECT SELECT user_id FROM orders',
      'SELECT id FROM users EXCEPT SELECT user_id FROM banned_users',
      'SELECT * FROM (VALUES (1, \'alice\'), (2, \'bob\')) AS t(id, name)',
      'SELECT 1 FROM users WHERE EXISTS (SELECT 1 FROM orders WHERE orders.user_id = users.id)',
      'SELECT 1 FROM users WHERE id = ANY (ARRAY[1, 2, 3])',
      'SELECT u.id, o.total FROM users u, LATERAL (SELECT count(*) AS total FROM orders WHERE orders.user_id = u.id) o',
      'SELECT 1 FROM users TABLESAMPLE SYSTEM (10)',
      'SELECT json_build_object(\'id\', id, \'name\', name) FROM users',
      'SELECT to_jsonb(id) FROM users',
      'SELECT unnest(ARRAY[1, 2, 3])',
      'SELECT array_agg(id ORDER BY id) FROM users',
      'SELECT now(), current_date, current_time',
      'SELECT date_trunc(\'month\', created_at) FROM users',
      'SELECT abs(val), round(val, 2), floor(val), ceil(val) FROM stats',
      'SELECT lower(name), upper(name), trim(name), length(name) FROM users',
      'SELECT substr(name, 1, 3), concat(first_name, \' \', last_name) FROM users',
      'SELECT coalesce(nickname, name, \'Anonymous\') FROM users',
      'SELECT CASE WHEN active THEN \'Active\' ELSE \'Inactive\' END FROM users',
      'SELECT CASE status WHEN 1 THEN \'Pending\' WHEN 2 THEN \'Completed\' ELSE \'Unknown\' END FROM orders',
      'SELECT id FROM users ORDER BY created_at DESC',
    ];

    it.each(allowedQueries)('round-trips %s without semantic loss', async (sql) => {
      const { tree } = await parseSql(sql);
      const result = await rewrite(tree, {
        maxRows: 1000,
        originalSql: sql,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.sql).toBeDefined();
      expect(result.sql.length).toBeGreaterThan(0);
    });
  });
});
