import { describe, it, expect } from 'vitest';
import { parseSql } from '../../../src/safety/parse.js';
import { checkColumns } from '../../../src/safety/policy.js';
import { createPolicyIndex } from '../../fixtures/policy-index.js';
import type { PolicyIndex } from '../../../src/types.js';
import type { PgmoatConfigT } from '../../../src/config/schema.js';

describe('Column, whole-row, and star policy (policy-columns.test.ts)', () => {
  const index: PolicyIndex = createPolicyIndex({
    exposedSchemas: ['public'],
    knownRelations: ['public.users', 'public.orders', 'public.contacts'],
    hiddenRelations: [],
    hiddenColumns: {
      'public.users': ['password_hash', 'ssn', 'secret_token'],
    },
    visibleColumns: {
      'public.users': ['id', 'name', 'email', 'created_at'],
      'public.orders': ['id', 'user_id', 'amount', 'status'],
      'public.contacts': ['id', 'user_id', 'ssn_last4', 'status'],
    },
  });

  async function testCol(
    sql: string,
    policy?: Partial<PgmoatConfigT['policy']>,
  ) {
    const parsed = await parseSql(sql);
    return checkColumns(parsed.tree, index, policy);
  }

  // --- Allowed column queries ---
  describe('allowed column queries', () => {
    it('allows query selecting visible columns only', async () => {
      const res = await testCol('SELECT id, name, email FROM users');
      expect(res.ok).toBe(true);
    });

    it('allows alias-qualified visible columns', async () => {
      const res = await testCol('SELECT u.id, u.name FROM users u');
      expect(res.ok).toBe(true);
    });

    it('allows count(*)', async () => {
      const res = await testCol('SELECT count(*) FROM users');
      expect(res.ok).toBe(true);
    });

    it('allows SELECT o.* when only users has hidden columns', async () => {
      const res = await testCol('SELECT o.* FROM orders o JOIN users u ON u.id = o.user_id');
      expect(res.ok).toBe(true);
    });

    it('allows qualified non-hidden column when another table in scope has hidden column of same name', async () => {
      // Suppose contacts has 'status' and orders has 'status' (neither hidden)
      const res = await testCol('SELECT o.status FROM orders o JOIN users u ON u.id = o.user_id');
      expect(res.ok).toBe(true);
    });
  });

  // --- Direct and qualified hidden columns (PGM-208) ---
  describe('direct and qualified hidden columns (PGM-208)', () => {
    it('refuses direct hidden column reference (password_hash)', async () => {
      const res = await testCol('SELECT password_hash FROM users');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('PGM-208');
        expect(res.message).toContain('Column access not allowed');
        expect(res.message).toContain('Allowed columns for public.users: id, name, email, created_at');
      }
    });

    it('refuses alias-qualified hidden column (u.password_hash)', async () => {
      const res = await testCol('SELECT u.password_hash FROM users u');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('PGM-208');
        expect(res.message).toContain('Column "u.password_hash" is hidden');
        expect(res.message).toContain('Allowed columns for public.users:');
      }
    });

    it('refuses table-qualified hidden column (users.password_hash)', async () => {
      const res = await testCol('SELECT users.password_hash FROM users');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-208');
    });

    it('refuses schema-qualified hidden column (public.users.password_hash)', async () => {
      const res = await testCol('SELECT public.users.password_hash FROM users');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-208');
    });

    it('refuses second hidden column (ssn)', async () => {
      const res = await testCol('SELECT ssn FROM users');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-208');
    });
  });

  // --- Strict vs non-strict unqualified columns ---
  describe('strict unqualified column policy', () => {
    it('refuses unqualified column matching any hidden column in scope in strict mode (default)', async () => {
      // In strict mode, if 'ssn' is hidden on users, unqualified 'ssn' in a join with another table is refused
      const res = await testCol('SELECT ssn FROM users u JOIN orders o ON o.user_id = u.id', {
        strict_unqualified_columns: true,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('PGM-208');
        expect(res.message).toContain('Unqualified column "ssn" matches a hidden column');
      }
    });

    it('refuses unqualified column in non-strict mode when only hiding table has it', async () => {
      const res = await testCol('SELECT ssn FROM users u JOIN orders o ON o.user_id = u.id', {
        strict_unqualified_columns: false,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-208');
    });
  });

  // --- Whole-row references (PGM-208) ---
  describe('whole-row references (PGM-208)', () => {
    it('refuses SELECT u FROM users u', async () => {
      const res = await testCol('SELECT u FROM users u');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('PGM-208');
        expect(res.message).toContain('Whole-row reference to "u" exposes hidden columns');
        expect(res.message).toContain('Allowed columns for public.users:');
      }
    });

    it('refuses SELECT users FROM users (bare table name whole-row reference)', async () => {
      const res = await testCol('SELECT users FROM users');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-208');
    });

    it('refuses to_jsonb(u) FROM users u', async () => {
      const res = await testCol('SELECT to_jsonb(u) FROM users u');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-208');
    });

    it('refuses to_json(u) FROM users u', async () => {
      const res = await testCol('SELECT to_json(u) FROM users u');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-208');
    });

    it('refuses row_to_json(u.*) FROM users u', async () => {
      const res = await testCol('SELECT row_to_json(u.*) FROM users u');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-208');
    });
  });

  // --- Wildcard star queries (PGM-208) ---
  describe('star queries (PGM-208)', () => {
    it('refuses SELECT * FROM users (single table with hidden columns)', async () => {
      const res = await testCol('SELECT * FROM users');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('PGM-208');
        expect(res.message).toContain('Wildcard "*" on table with hidden columns');
        expect(res.message).toContain('Allowed columns for public.users:');
      }
    });

    it('refuses SELECT * FROM users u JOIN orders o ... (join where one table has hidden columns)', async () => {
      const res = await testCol('SELECT * FROM users u JOIN orders o ON o.user_id = u.id');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-208');
    });

    it('refuses SELECT u.* FROM users u', async () => {
      const res = await testCol('SELECT u.* FROM users u');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('PGM-208');
        expect(res.message).toContain('Wildcard "u.*" on table with hidden columns');
      }
    });

    it('refuses SELECT users.* FROM users', async () => {
      const res = await testCol('SELECT users.* FROM users');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-208');
    });

    it('refuses SELECT public.users.* FROM users', async () => {
      const res = await testCol('SELECT public.users.* FROM users');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-208');
    });
  });

  // --- Hidden columns in clauses (WHERE, ORDER BY, GROUP BY, etc.) ---
  describe('hidden columns in clauses', () => {
    it('refuses hidden column in WHERE clause', async () => {
      const res = await testCol("SELECT id FROM users WHERE password_hash = 'secret'");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-208');
    });

    it('refuses alias-qualified hidden column in WHERE clause', async () => {
      const res = await testCol("SELECT u.id FROM users u WHERE u.password_hash = 'secret'");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-208');
    });

    it('refuses hidden column in ORDER BY clause', async () => {
      const res = await testCol('SELECT id FROM users ORDER BY ssn DESC');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-208');
    });

    it('refuses hidden column in GROUP BY clause', async () => {
      const res = await testCol('SELECT count(*) FROM users GROUP BY ssn');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-208');
    });

    it('refuses hidden column in HAVING clause', async () => {
      const res = await testCol('SELECT id FROM users GROUP BY id HAVING max(ssn) > "100"');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-208');
    });

    it('refuses hidden column in JOIN ON clause', async () => {
      const res = await testCol('SELECT u.id FROM users u JOIN orders o ON o.user_id = u.password_hash');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-208');
    });

    it('refuses hidden column in window PARTITION BY', async () => {
      const res = await testCol('SELECT id, rank() OVER (PARTITION BY password_hash ORDER BY id) FROM users');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-208');
    });

    it('refuses hidden column inside CTE body', async () => {
      const res = await testCol('WITH user_cte AS (SELECT password_hash FROM users) SELECT * FROM user_cte');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-208');
    });

    it('refuses hidden column inside subquery', async () => {
      const res = await testCol('SELECT (SELECT u.password_hash FROM users u WHERE u.id = o.user_id) FROM orders o');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-208');
    });

    it('refuses star inside subquery over table with hidden columns', async () => {
      const res = await testCol('SELECT (SELECT count(*) FROM (SELECT * FROM users) s) FROM orders');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-208');
    });
  });
});
