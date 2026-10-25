import { describe, it, expect } from 'vitest';
import { runSafety } from '../../../src/safety/pipeline.js';
import { createPolicyIndex } from '../../fixtures/policy-index.js';

describe('Safety Pipeline Orchestrator (P2.9)', () => {
  const defaultIndex = createPolicyIndex({
    knownRelations: ['public.users', 'public.orders'],
    exposedSchemas: ['public'],
    hiddenColumns: { 'public.users': ['password_hash'] },
  });

  describe('Parse stage', () => {
    it('passes parse stage on valid SQL', async () => {
      const res = await runSafety('SELECT id FROM users', { policyIndex: defaultIndex });
      expect(res.allowed).toBe(true);
      if (!res.allowed) return;
      expect(res.timings.parseMs).toBeGreaterThanOrEqual(0);
    });

    it('refuses empty SQL with PGM-206', async () => {
      const res = await runSafety('   ', { policyIndex: defaultIndex });
      expect(res.allowed).toBe(false);
      if (res.allowed) return;
      expect(res.code).toBe('PGM-206');
      expect(res.timings.parseMs).toBeGreaterThanOrEqual(0);
    });

    it('refuses SQL exceeding max_sql_chars with PGM-206', async () => {
      const res = await runSafety('SELECT 1', {
        policyIndex: defaultIndex,
        budgets: { max_sql_chars: 5 },
      });
      expect(res.allowed).toBe(false);
      if (res.allowed) return;
      expect(res.code).toBe('PGM-206');
    });
  });

  describe('Classify stage', () => {
    it('refuses forbidden statement (DROP TABLE) with PGM-201', async () => {
      const res = await runSafety('DROP TABLE users', { policyIndex: defaultIndex });
      expect(res.allowed).toBe(false);
      if (res.allowed) return;
      expect(res.code).toBe('PGM-201');
      expect(res.node).toBe('DropStmt');
      expect(res.timings.classifyMs).toBeGreaterThanOrEqual(0);
    });

    it('refuses multiple statements (stacking) with PGM-204', async () => {
      const res = await runSafety('SELECT 1; DROP TABLE users', { policyIndex: defaultIndex });
      expect(res.allowed).toBe(false);
      if (res.allowed) return;
      expect(res.code).toBe('PGM-204');
    });

    it('refuses writing CTE with PGM-203', async () => {
      const res = await runSafety('WITH del AS (DELETE FROM users RETURNING id) SELECT * FROM del', {
        policyIndex: defaultIndex,
      });
      expect(res.allowed).toBe(false);
      if (res.allowed) return;
      expect(res.code).toBe('PGM-203');
    });

    it('refuses disallowed function (pg_sleep) with PGM-205', async () => {
      const res = await runSafety('SELECT pg_sleep(5)', { policyIndex: defaultIndex });
      expect(res.allowed).toBe(false);
      if (res.allowed) return;
      expect(res.code).toBe('PGM-205');
    });
  });

  describe('Policy stage', () => {
    it('refuses unknown table with PGM-207', async () => {
      const res = await runSafety('SELECT * FROM secret_table', { policyIndex: defaultIndex });
      expect(res.allowed).toBe(false);
      if (res.allowed) return;
      expect(res.code).toBe('PGM-207');
      expect(res.timings.policyMs).toBeGreaterThanOrEqual(0);
    });

    it('refuses access to hidden column with PGM-208', async () => {
      const res = await runSafety('SELECT password_hash FROM users', { policyIndex: defaultIndex });
      expect(res.allowed).toBe(false);
      if (res.allowed) return;
      expect(res.code).toBe('PGM-208');
    });

    it('allows access to visible columns on allowed tables', async () => {
      const res = await runSafety('SELECT id FROM users', { policyIndex: defaultIndex });
      expect(res.allowed).toBe(true);
    });
  });

  describe('Rewrite stage', () => {
    it('injects LIMIT max_rows + 1 in query mode when no limit is provided', async () => {
      const res = await runSafety('SELECT id FROM users', {
        policyIndex: defaultIndex,
        budgets: { max_rows: 50 },
        mode: 'query',
      });

      expect(res.allowed).toBe(true);
      if (!res.allowed) return;
      expect(res.limitInjected).toBe(true);
      expect(res.sql).toMatch(/LIMIT 51/);
      expect(res.statementType).toBe('select');
      expect(res.timings.rewriteMs).toBeGreaterThanOrEqual(0);
    });

    it('refuses explicit LIMIT exceeding max_rows with PGM-302', async () => {
      const res = await runSafety('SELECT id FROM users LIMIT 1000', {
        policyIndex: defaultIndex,
        budgets: { max_rows: 100 },
      });

      expect(res.allowed).toBe(false);
      if (res.allowed) return;
      expect(res.code).toBe('PGM-302');
    });

    it('skips LIMIT injection in explain mode', async () => {
      const sql = 'SELECT id FROM users';
      const res = await runSafety(sql, {
        policyIndex: defaultIndex,
        budgets: { max_rows: 50 },
        mode: 'explain',
      });

      expect(res.allowed).toBe(true);
      if (!res.allowed) return;
      expect(res.limitInjected).toBe(false);
      expect(res.sql).toBe(sql);
    });
  });

  describe('Fingerprint and timings', () => {
    it('generates a 16-hex deterministic fingerprint and all timings', async () => {
      const res = await runSafety('SELECT id FROM users WHERE id = 123', {
        policyIndex: defaultIndex,
      });

      expect(res.allowed).toBe(true);
      if (!res.allowed) return;

      expect(res.fingerprint).toMatch(/^[0-9a-f]{16}$/);
      expect(res.timings.parseMs).toBeGreaterThanOrEqual(0);
      expect(res.timings.classifyMs).toBeGreaterThanOrEqual(0);
      expect(res.timings.policyMs).toBeGreaterThanOrEqual(0);
      expect(res.timings.rewriteMs).toBeGreaterThanOrEqual(0);
      expect(res.timings.fingerprintMs).toBeGreaterThanOrEqual(0);
      expect(res.timings.totalMs).toBeGreaterThanOrEqual(0);
    });

    it('refuses deeply nested subqueries safely without unhandled exception (F-P2-06)', async () => {
      let q = 'SELECT 1';
      for (let i = 0; i < 350; i++) {
        q = 'SELECT (' + q + ')';
      }
      const res = await runSafety(q, {
        policyIndex: defaultIndex,
        mode: 'query',
      });
      expect(res.allowed).toBe(false);
      expect(res.code).toBe('PGM-206');
    });
  });
});

