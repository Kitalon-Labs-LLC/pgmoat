import { describe, it, expect } from 'vitest';
import { parseSql } from '../../../src/safety/parse.js';
import {
  walk,
  getNodeType,
  unwrap,
  type Scope,
} from '../../../src/safety/walk.js';
import { PgmoatError } from '../../../src/errors.js';

describe('AST walker (walk.ts)', () => {
  describe('getNodeType and unwrap', () => {
    it('identifies wrapped node types', () => {
      expect(getNodeType({ SelectStmt: { op: 'SETOP_NONE' } })).toBe(
        'SelectStmt',
      );
      expect(getNodeType({ ColumnRef: { fields: [] } })).toBe('ColumnRef');
      expect(getNodeType({ notANode: 123 })).toBeNull();
      expect(getNodeType(null)).toBeNull();
      expect(getNodeType([1, 2, 3])).toBeNull();
      expect(getNodeType({ A: 1, B: 2 })).toBeNull();
    });

    it('unwraps wrapped nodes and leaves unwrapped nodes unchanged', () => {
      const payload = { targetList: [] };
      expect(unwrap({ SelectStmt: payload })).toBe(payload);
      expect(unwrap(payload)).toBe(payload);
      expect(unwrap('scalar')).toBe('scalar');
      expect(unwrap(null)).toBeNull();
    });
  });

  describe('AST walking and scope tracking', () => {
    it('counts every ColumnRef in a complex query', async () => {
      const sql = `
        WITH cte AS (
          SELECT o.user_id, SUM(o.amount) AS total
          FROM orders o
          WHERE o.status = 'completed'
          GROUP BY o.user_id
          HAVING SUM(o.amount) > 100
        )
        SELECT u.name, c.total
        FROM users u
        JOIN cte c ON c.user_id = u.id
        WHERE u.active = true
        ORDER BY c.total DESC
      `;
      const parsed = await parseSql(sql);

      let columnRefCount = 0;
      const columnRefs: string[] = [];

      walk(parsed.tree, (node, type) => {
        if (type === 'ColumnRef') {
          columnRefCount++;
          const inner = node as {
            fields?: Array<{ String?: { sval?: string } }>;
          };
          const colName = inner.fields
            ?.map((f) => f.String?.sval)
            .filter(Boolean)
            .join('.');
          if (colName) {
            columnRefs.push(colName);
          }
        }
      });

      // Expected ColumnRefs:
      // In CTE:
      // - o.user_id (targetList)
      // - o.amount (SUM in targetList)
      // - o.status (WHERE)
      // - o.user_id (GROUP BY)
      // - o.amount (SUM in HAVING)
      // In main query:
      // - u.name (targetList)
      // - c.total (targetList)
      // - c.user_id (JOIN ON)
      // - u.id (JOIN ON)
      // - u.active (WHERE)
      // - c.total (ORDER BY)
      expect(columnRefCount).toBe(11);
      expect(columnRefs).toContain('o.user_id');
      expect(columnRefs).toContain('u.name');
      expect(columnRefs).toContain('c.total');
    });

    it('scope of a column in a subquery includes outer relations', async () => {
      const sql = `
        SELECT (SELECT u.name FROM users u WHERE u.id = a.user_id)
        FROM accounts a
      `;
      const parsed = await parseSql(sql);

      let innerWhereScope: Scope | null = null;

      walk(parsed.tree, (node, type, path, scope) => {
        if (type === 'ColumnRef') {
          const inner = node as {
            fields?: Array<{ String?: { sval?: string } }>;
          };
          const colName = inner.fields?.map((f) => f.String?.sval).join('.');
          if (colName === 'a.user_id') {
            innerWhereScope = scope;
          }
        }
      });

      expect(innerWhereScope).not.toBeNull();
      // In the inner scope, local relations are 'users u'
      expect(
        innerWhereScope?.relations.some(
          (r) => r.alias === 'u' && r.name === 'users',
        ),
      ).toBe(true);
      // Outer scope has 'accounts a'
      expect(
        innerWhereScope?.parent?.relations.some(
          (r) => r.alias === 'a' && r.name === 'accounts',
        ),
      ).toBe(true);
    });

    it('CTE names are visible in scope', async () => {
      const sql = `
        WITH regional_sales AS (
          SELECT region, SUM(amount) AS total FROM orders GROUP BY region
        )
        SELECT * FROM regional_sales
      `;
      const parsed = await parseSql(sql);

      let mainQueryScope: Scope | null = null;

      walk(parsed.tree, (node, type, path, scope) => {
        if (type === 'SelectStmt' && path.length === 3 && path[2] === 'stmt') {
          mainQueryScope = scope;
        }
      });

      expect(mainQueryScope).not.toBeNull();
      expect(mainQueryScope?.ctes.has('regional_sales')).toBe(true);
    });

    it('CTE shadows an unqualified table name', async () => {
      const sql = `
        WITH users AS (
          SELECT 1 AS id
        )
        SELECT * FROM users
      `;
      const parsed = await parseSql(sql);

      let foundUsersRelation = false;

      walk(parsed.tree, (node, type, path, scope) => {
        if (type === 'RangeVar') {
          const matching = scope.relations.find((r) => r.name === 'users');
          if (matching) {
            foundUsersRelation = true;
            expect(matching.isCte).toBe(true);
            expect(matching.schema).toBeNull();
          }
        }
      });

      expect(foundUsersRelation).toBe(true);
    });

    it('schema-qualified table is not shadowed by CTE', async () => {
      const sql = `
        WITH users AS (
          SELECT 1 AS id
        )
        SELECT * FROM public.users
      `;
      const parsed = await parseSql(sql);

      let foundPublicUsersRelation = false;

      walk(parsed.tree, (node, type, path, scope) => {
        if (type === 'RangeVar') {
          const matching = scope.relations.find((r) => r.name === 'users');
          if (matching && matching.schema === 'public') {
            foundPublicUsersRelation = true;
            expect(matching.isCte).toBe(false);
          }
        }
      });

      expect(foundPublicUsersRelation).toBe(true);
    });

    it('LATERAL subqueries see earlier relations in the same FROM list', async () => {
      const sql = `
        SELECT *
        FROM departments d,
        LATERAL (SELECT * FROM employees e WHERE e.dept_id = d.id) sub
      `;
      const parsed = await parseSql(sql);

      let lateralSelectScope: Scope | null = null;

      walk(parsed.tree, (node, type, path, scope) => {
        if (type === 'RangeSubselect') {
          // The subquery scope inside RangeSubselect
          // When walking subquery, its parent scope should have 'departments d'
        }
        if (type === 'ColumnRef') {
          const inner = node as {
            fields?: Array<{ String?: { sval?: string } }>;
          };
          const colName = inner.fields?.map((f) => f.String?.sval).join('.');
          if (colName === 'd.id') {
            lateralSelectScope = scope;
          }
        }
      });

      expect(lateralSelectScope).not.toBeNull();
      // The parent of the lateral subquery has departments d
      expect(
        lateralSelectScope?.parent?.relations.some(
          (r) => r.alias === 'd' && r.name === 'departments',
        ),
      ).toBe(true);
    });

    it('set operation arms have separate scopes and inherit outer CTEs', async () => {
      const sql = `
        WITH shared_cte AS (SELECT 1 AS val)
        SELECT a.col1 FROM table_a a
        UNION ALL
        SELECT b.col2 FROM table_b b
      `;
      const parsed = await parseSql(sql);

      let leftColScope: Scope | null = null;
      let rightColScope: Scope | null = null;

      walk(parsed.tree, (node, type, path, scope) => {
        if (type === 'ColumnRef') {
          const inner = node as {
            fields?: Array<{ String?: { sval?: string } }>;
          };
          const colName = inner.fields?.map((f) => f.String?.sval).join('.');
          if (colName === 'a.col1') {
            leftColScope = scope;
          } else if (colName === 'b.col2') {
            rightColScope = scope;
          }
        }
      });

      expect(leftColScope).not.toBeNull();
      expect(rightColScope).not.toBeNull();

      // Left arm has table_a, not table_b
      expect(leftColScope?.relations.some((r) => r.name === 'table_a')).toBe(
        true,
      );
      expect(leftColScope?.relations.some((r) => r.name === 'table_b')).toBe(
        false,
      );

      // Right arm has table_b, not table_a
      expect(rightColScope?.relations.some((r) => r.name === 'table_b')).toBe(
        true,
      );
      expect(rightColScope?.relations.some((r) => r.name === 'table_a')).toBe(
        false,
      );

      // Both arms see shared_cte
      expect(leftColScope?.ctes.has('shared_cte')).toBe(true);
      expect(rightColScope?.ctes.has('shared_cte')).toBe(true);
    });

    it('enforces depth cap at 1000 and throws PGM-206', () => {
      // Construct a deeply nested object exceeding depth 1000
      let deep: Record<string, unknown> = { val: 1 };
      for (let i = 0; i < 1005; i++) {
        deep = { nested: deep };
      }

      expect(() => {
        walk(deep, () => {});
      }).toThrowError(PgmoatError);

      try {
        walk(deep, () => {});
      } catch (err) {
        expect(err).toBeInstanceOf(PgmoatError);
        expect((err as PgmoatError).code).toBe('PGM-206');
        expect((err as PgmoatError).message).toContain(
          'AST depth exceeded limit',
        );
      }
    });
  });
});
