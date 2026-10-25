import { describe, it, expect, vi } from 'vitest';
import { sanitizeMessage, mapPgError } from '../../../src/postgres/errors.js';
import { PgmoatError } from '../../../src/errors.js';

describe('Postgres Error Mapping and Sanitization (P3.3)', () => {
  describe('sanitizeMessage', () => {
    it('strips Key (...)=(...) pattern to prevent value leakage', () => {
      const raw =
        'duplicate key value violates unique constraint "users_email_key" Key (email)=(secret@corp.com) already exists.';
      const sanitized = sanitizeMessage(raw);
      expect(sanitized).toBe(
        'duplicate key value violates unique constraint "users_email_key" Key (...) already exists.',
      );
      expect(sanitized).not.toContain('secret@corp.com');
    });

    it('strips composite Key (...)=(...) patterns', () => {
      const raw =
        'violates unique constraint Key (tenant_id, user_id)=(tnt_123, usr_456) already exists.';
      const sanitized = sanitizeMessage(raw);
      expect(sanitized).toContain('Key (...)');
      expect(sanitized).not.toContain('tnt_123');
      expect(sanitized).not.toContain('usr_456');
    });

    it('strips DETAIL: and WHERE: clauses', () => {
      const raw =
        'error in expression\nDETAIL: Key (id)=(1) failed\nWHERE: PL/pgSQL function test() line 12';
      const sanitized = sanitizeMessage(raw);
      expect(sanitized).not.toContain('DETAIL:');
      expect(sanitized).not.toContain('WHERE:');
      expect(sanitized).toBe('error in expression');
    });

    it('truncates messages exceeding 300 characters', () => {
      const longMsg = 'A'.repeat(350);
      const sanitized = sanitizeMessage(longMsg);
      expect(sanitized.length).toBe(300);
      expect(sanitized.endsWith('...')).toBe(true);
    });
  });

  describe('mapPgError', () => {
    it('preserves existing PgmoatError', () => {
      const existing = new PgmoatError('PGM-101', 'config error');
      expect(mapPgError(existing)).toBe(existing);
    });

    it('maps SQLSTATE 57014 without abort signal to PGM-303 timeout', () => {
      const pgErr = {
        code: '57014',
        message: 'canceling statement due to statement timeout',
      };
      const mapped = mapPgError(pgErr, { max_query_ms: 1000, lock_timeout_ms: 500 });
      expect(mapped.code).toBe('PGM-303');
      expect(mapped.kind).toBe('error');
    });

    it('maps SQLSTATE 57014 with abort signal to PGM-505 canceled', () => {
      const controller = new AbortController();
      controller.abort();

      const pgErr = {
        code: '57014',
        message: 'canceling statement due to user request',
      };
      const mapped = mapPgError(
        pgErr,
        { max_query_ms: 1000, lock_timeout_ms: 500 },
        controller.signal,
      );
      expect(mapped.code).toBe('PGM-505');
      expect(mapped.kind).toBe('canceled');
    });

    it('maps SQLSTATE 55P03 to PGM-303 lock wait timeout', () => {
      const pgErr = {
        code: '55P03',
        message: 'canceling statement due to lock timeout',
      };
      const mapped = mapPgError(pgErr);
      expect(mapped.code).toBe('PGM-303');
      expect(mapped.message).toContain('lock');
    });

    it('maps SQLSTATE 25006 to PGM-201 and logs warn with fingerprint', () => {
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const pgErr = {
        code: '25006',
        message: 'cannot execute INSERT in a read-only transaction',
      };
      const mapped = mapPgError(
        pgErr,
        undefined,
        undefined,
        logger,
        'fp_abc_123',
      );
      expect(mapped.code).toBe('PGM-201');
      expect(mapped.kind).toBe('refused');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('fp_abc_123'),
      );
    });

    it('maps connection drops and admin shutdowns to PGM-504', () => {
      const err1 = { code: '57P01', message: 'terminating connection due to administrator command' };
      expect(mapPgError(err1).code).toBe('PGM-504');

      const err2 = { code: '08006', message: 'connection failure' };
      expect(mapPgError(err2).code).toBe('PGM-504');

      const err3 = new Error('Connection terminated unexpectedly');
      expect(mapPgError(err3).code).toBe('PGM-504');
    });

    it('maps general Postgres errors (42P01, 42703, 42601) to PGM-506 with sanitized message', () => {
      const pgErr = {
        code: '42P01',
        message: 'relation "unknown_table" does not exist',
      };
      const mapped = mapPgError(pgErr);
      expect(mapped.code).toBe('PGM-506');
      expect(mapped.kind).toBe('error');
      expect(mapped.message).toBe('relation "unknown_table" does not exist');
    });
  });
});

