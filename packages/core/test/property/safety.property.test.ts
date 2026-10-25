import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { runSafety } from '../../src/safety/pipeline.js';
import { corpusPolicyIndex } from '../corpus/fixture-schema.js';
import { PgmoatError } from '../../src/errors.js';

const numRuns = process.env.FC_RUNS ? Number(process.env.FC_RUNS) : 100;

describe('Safety Pipeline Property Tests (P2.13)', () => {
  it('property 1: for random strings, runSafety never crashes with non-PgmoatError', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (randomSql) => {
        try {
          const res = await runSafety(randomSql, {
            policyIndex: corpusPolicyIndex,
          });
          expect(res).toBeDefined();
          expect(typeof res.allowed).toBe('boolean');
        } catch (err: unknown) {
          // If it throws, it must strictly be a PgmoatError
          expect(err).toBeInstanceOf(PgmoatError);
        }
      }),
      { numRuns },
    );
  });

  it('property 2: random valid SELECT combinations are allowed and preserve rewrite invariant', async () => {
    const targets = ['id', 'name', 'email', 'created_at', 'tenant_id'];
    const wheres = [
      '',
      'WHERE id = 1',
      'WHERE id > 0 AND tenant_id = \'t1\'',
      'WHERE email LIKE \'%@example.com\'',
      'WHERE created_at < now()',
    ];
    const orderBys = ['', 'ORDER BY id', 'ORDER BY created_at DESC'];
    const limits = ['', 'LIMIT 10', 'LIMIT 50', 'LIMIT 100'];

    const selectGen = fc.record({
      cols: fc.subarray(targets, { minLength: 1 }),
      where: fc.constantFrom(...wheres),
      orderBy: fc.constantFrom(...orderBys),
      limit: fc.constantFrom(...limits),
    });

    await fc.assert(
      fc.asyncProperty(selectGen, async ({ cols, where, orderBy, limit }) => {
        const parts = [
          `SELECT ${cols.join(', ')}`,
          'FROM users',
          where,
          orderBy,
          limit,
        ].filter(Boolean);

        const sql = parts.join(' ');
        const res = await runSafety(sql, {
          policyIndex: corpusPolicyIndex,
          budgets: { max_rows: 200 },
        });

        expect(res.allowed).toBe(true);
        if (!res.allowed) return;

        expect(res.sql).toBeDefined();
        expect(res.fingerprint).toMatch(/^[0-9a-f]{16}$/);
        expect(res.statementType).toBe('select');
      }),
      { numRuns },
    );
  });

  it('property 3: inserting a forbidden statement as a second statement always yields PGM-204 or PGM-206', async () => {
    const forbiddenStatements = [
      'DROP TABLE users',
      'DELETE FROM users',
      'INSERT INTO users (id, name) VALUES (1, \'hack\')',
      'UPDATE users SET name = \'pwned\'',
      'TRUNCATE TABLE users',
      'COMMIT',
      'ROLLBACK',
      'ALTER TABLE users ADD COLUMN x int',
      'CREATE TABLE evil (id int)',
      'GRANT ALL ON users TO PUBLIC',
    ];

    const validQueries = [
      'SELECT id FROM users',
      'SELECT count(*) FROM orders',
      'SELECT 1',
    ];

    const stackedGen = fc.record({
      valid: fc.constantFrom(...validQueries),
      separator: fc.constantFrom(';', ';\n', '; -- comment\n', '; /* block */ '),
      forbidden: fc.constantFrom(...forbiddenStatements),
    });

    await fc.assert(
      fc.asyncProperty(stackedGen, async ({ valid, separator, forbidden }) => {
        const sql = `${valid}${separator}${forbidden}`;
        const res = await runSafety(sql, {
          policyIndex: corpusPolicyIndex,
        });

        expect(res.allowed).toBe(false);
        if (res.allowed) return;

        expect(['PGM-204', 'PGM-206']).toContain(res.code);
      }),
      { numRuns },
    );
  });

  it('property 4: any generated query referencing internal_audit yields PGM-207', async () => {
    const templates = [
      (rel: string) => `SELECT * FROM ${rel}`,
      (rel: string) => `SELECT id FROM ${rel} WHERE id = 1`,
      (rel: string) => `SELECT u.id FROM users u JOIN ${rel} x ON u.id = x.id`,
      (rel: string) => `SELECT * FROM users WHERE id IN (SELECT id FROM ${rel})`,
      (rel: string) => `WITH sub AS (SELECT * FROM ${rel}) SELECT * FROM sub`,
    ];

    const relForms = [
      'internal_audit',
      'public.internal_audit',
      '"internal_audit"',
      '"public"."internal_audit"',
    ];

    const auditGen = fc.record({
      template: fc.constantFrom(...templates),
      rel: fc.constantFrom(...relForms),
    });

    await fc.assert(
      fc.asyncProperty(auditGen, async ({ template, rel }) => {
        const sql = template(rel);
        const res = await runSafety(sql, {
          policyIndex: corpusPolicyIndex,
        });

        expect(res.allowed).toBe(false);
        if (res.allowed) return;

        expect(res.code).toBe('PGM-207');
      }),
      { numRuns },
    );
  });
});
