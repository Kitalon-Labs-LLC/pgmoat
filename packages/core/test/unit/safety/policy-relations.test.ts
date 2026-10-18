import { describe, it, expect } from 'vitest';
import { parseSql } from '../../../src/safety/parse.js';
import { checkRelations } from '../../../src/safety/policy.js';
import { createPolicyIndex } from '../../fixtures/policy-index.js';
import type { PolicyIndex } from '../../../src/types.js';
import type { PgmoatConfigT } from '../../../src/config/schema.js';

describe('Relation access policy (policy-relations.test.ts)', () => {
  const index: PolicyIndex = createPolicyIndex({
    exposedSchemas: ['public', 'app'],
    knownRelations: [
      'public.users',
      'public.orders',
      'public.products',
      'app.tenants',
      'public.CaseSensitive',
    ],
    hiddenRelations: [
      'public.secrets',
      'public.hidden_audit',
      'app.internal_keys',
    ],
  });

  async function testRel(
    sql: string,
    policy?: Partial<PgmoatConfigT['policy']>,
  ) {
    const parsed = await parseSql(sql);
    return checkRelations(parsed.tree, index, policy);
  }

  // --- Allowed relations ---
  describe('allowed relations', () => {
    it('allows direct query on visible table', async () => {
      const res = await testRel('SELECT * FROM users');
      expect(res.ok).toBe(true);
    });

    it('allows schema-qualified query on visible table', async () => {
      const res = await testRel('SELECT * FROM public.orders');
      expect(res.ok).toBe(true);
    });

    it('allows query on second exposed schema (app.tenants)', async () => {
      const res = await testRel('SELECT * FROM tenants');
      expect(res.ok).toBe(true);
    });

    it('allows join between visible tables', async () => {
      const res = await testRel(
        'SELECT * FROM users u JOIN orders o ON o.user_id = u.id',
      );
      expect(res.ok).toBe(true);
    });

    it('allows visible table in subquery', async () => {
      const res = await testRel(
        'SELECT (SELECT count(*) FROM orders) FROM users',
      );
      expect(res.ok).toBe(true);
    });

    it('allows visible table in CTE body', async () => {
      const res = await testRel(
        'WITH my_cte AS (SELECT * FROM products) SELECT * FROM my_cte',
      );
      expect(res.ok).toBe(true);
    });

    it('allows visible table in UNION', async () => {
      const res = await testRel(
        'SELECT id FROM users UNION SELECT id FROM orders',
      );
      expect(res.ok).toBe(true);
    });
  });

  // --- Hidden relations (PGM-207) ---
  describe('hidden relations (PGM-207)', () => {
    it('refuses hidden table directly (unqualified)', async () => {
      const res = await testRel('SELECT * FROM secrets');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('PGM-207');
        expect(res.message).toBe(
          'Table not available. Use list_tables to see the tables you can query.',
        );
      }
    });

    it('refuses hidden table (schema-qualified)', async () => {
      const res = await testRel('SELECT * FROM public.secrets');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-207');
    });

    it('refuses hidden table in second exposed schema', async () => {
      const res = await testRel('SELECT * FROM app.internal_keys');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-207');
    });

    it('refuses hidden table in join', async () => {
      const res = await testRel(
        'SELECT * FROM users u JOIN secrets s ON s.user_id = u.id',
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-207');
    });

    it('refuses hidden table in subquery', async () => {
      const res = await testRel(
        'SELECT (SELECT token FROM secrets) FROM users',
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-207');
    });

    it('refuses hidden table in CTE body', async () => {
      const res = await testRel(
        'WITH c AS (SELECT * FROM secrets) SELECT * FROM c',
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-207');
    });

    it('refuses hidden table in LATERAL subquery', async () => {
      const res = await testRel(
        'SELECT * FROM users u, LATERAL (SELECT * FROM secrets s WHERE s.user_id = u.id) l',
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-207');
    });

    it('refuses hidden table in set operation arm', async () => {
      const res = await testRel(
        'SELECT id FROM users UNION SELECT id FROM secrets',
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-207');
    });
  });

  // --- Unknown relations & unexposed schemas (PGM-207) ---
  describe('unknown and unexposed relations (PGM-207)', () => {
    it('refuses unknown table directly', async () => {
      const res = await testRel('SELECT * FROM non_existent_table');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('PGM-207');
        expect(res.message).toBe(
          'Table not available. Use list_tables to see the tables you can query.',
        );
      }
    });

    it('refuses table in unexposed schema', async () => {
      const res = await testRel('SELECT * FROM private_schema.users');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-207');
    });

    it('refuses unknown table in join', async () => {
      const res = await testRel(
        'SELECT * FROM users u JOIN ghost g ON g.id = u.id',
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-207');
    });

    it('refuses unknown table in subquery', async () => {
      const res = await testRel(
        'SELECT * FROM (SELECT * FROM nonexistent) sub',
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-207');
    });

    it('refuses unknown table in CTE body', async () => {
      const res = await testRel(
        'WITH c AS (SELECT * FROM nonexistent) SELECT * FROM c',
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-207');
    });

    it('refuses unknown table in set operation arm', async () => {
      const res = await testRel(
        'SELECT id FROM users UNION SELECT id FROM nonexistent',
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-207');
    });

    it('asserts identical refusal code and message for hidden and unknown tables', async () => {
      const resHidden = await testRel('SELECT * FROM secrets');
      const resUnknown = await testRel('SELECT * FROM nonexistent');

      expect(resHidden.ok).toBe(false);
      expect(resUnknown.ok).toBe(false);

      if (!resHidden.ok && !resUnknown.ok) {
        expect(resHidden.code).toBe(resUnknown.code);
        expect(resHidden.message).toBe(resUnknown.message);
      }
    });
  });

  // --- Catalog tables (PGM-207) ---
  describe('system catalog queries', () => {
    it('refuses pg_catalog.pg_class when allow_catalog_queries is false', async () => {
      const res = await testRel('SELECT * FROM pg_catalog.pg_class', {
        allow_catalog_queries: false,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-207');
    });

    it('refuses information_schema.tables when allow_catalog_queries is false', async () => {
      const res = await testRel('SELECT * FROM information_schema.tables', {
        allow_catalog_queries: false,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-207');
    });

    it('refuses pg_toast table when allow_catalog_queries is false', async () => {
      const res = await testRel('SELECT * FROM pg_toast.pg_toast_12345', {
        allow_catalog_queries: false,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-207');
    });

    it('refuses unqualified pg_class even when allow_catalog_queries is true (exposedSchemas only)', async () => {
      const res = await testRel('SELECT * FROM pg_class', {
        allow_catalog_queries: true,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-207');
    });

    it('allows pg_catalog.pg_class when allow_catalog_queries is true', async () => {
      const res = await testRel('SELECT * FROM pg_catalog.pg_class', {
        allow_catalog_queries: true,
      });
      expect(res.ok).toBe(true);
    });

    it('allows information_schema.tables when allow_catalog_queries is true', async () => {
      const res = await testRel('SELECT * FROM information_schema.tables', {
        allow_catalog_queries: true,
      });
      expect(res.ok).toBe(true);
    });
  });

  // --- CTE Shadowing ---
  describe('CTE shadowing', () => {
    it('CTE named secrets shadows hidden table secrets', async () => {
      const res = await testRel(
        'WITH secrets AS (SELECT 1 AS val) SELECT * FROM secrets',
      );
      expect(res.ok).toBe(true);
    });

    it('CTE in subquery shadows hidden table', async () => {
      const res = await testRel(
        'SELECT * FROM (WITH secrets AS (SELECT 1 AS val) SELECT * FROM secrets) sub',
      );
      expect(res.ok).toBe(true);
    });

    it('schema-qualified public.secrets inside query with secrets CTE is still refused', async () => {
      const res = await testRel(
        'WITH secrets AS (SELECT 1 AS val) SELECT * FROM public.secrets',
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-207');
    });
  });

  // --- Case sensitivity and quotes ---
  describe('quoted and case sensitivity', () => {
    it('allows quoted table matching exact case in knownRelations', async () => {
      const res = await testRel('SELECT * FROM "CaseSensitive"');
      expect(res.ok).toBe(true);
    });

    it('refuses quoted table with mismatched case', async () => {
      const res = await testRel('SELECT * FROM "casesensitive"');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-207');
    });
  });
});
