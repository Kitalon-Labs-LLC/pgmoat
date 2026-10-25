import { describe, it, expect } from 'vitest';
import { parseSql } from '../../../src/safety/parse.js';
import { classify } from '../../../src/safety/classify.js';
import {
  ALLOWED_FUNCTIONS,
  NEVER_ALLOWED_FUNCTIONS,
} from '../../../src/safety/functions.js';
import type { PgmoatConfigT } from '../../../src/config/schema.js';

describe('Function allow-list (functions.ts)', () => {
  async function testFunc(sql: string, config?: Partial<PgmoatConfigT>) {
    const parsed = await parseSql(sql);
    return classify(parsed.tree, { config });
  }

  it('exports frozen ALLOWED_FUNCTIONS and NEVER_ALLOWED_FUNCTIONS', () => {
    expect(ALLOWED_FUNCTIONS).toBeInstanceOf(Set);
    expect(NEVER_ALLOWED_FUNCTIONS).toBeInstanceOf(Set);
    expect(Object.isFrozen(ALLOWED_FUNCTIONS)).toBe(true);
    expect(Object.isFrozen(NEVER_ALLOWED_FUNCTIONS)).toBe(true);
    expect(ALLOWED_FUNCTIONS.size).toBeGreaterThan(100);
    expect(NEVER_ALLOWED_FUNCTIONS.size).toBeGreaterThan(50);
  });

  describe('never-allowed functions (PGM-205)', () => {
    // SQL-executing
    it('refuses query_to_xml', async () => {
      const res = await testFunc(
        "SELECT query_to_xml('SELECT 1', true, false, '')",
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses cursor_to_xml', async () => {
      const res = await testFunc(
        "SELECT cursor_to_xml('c', 1, true, false, '')",
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses table_to_xml', async () => {
      const res = await testFunc("SELECT table_to_xml('t', true, false, '')");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses schema_to_xml', async () => {
      const res = await testFunc("SELECT schema_to_xml('s', true, false, '')");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses database_to_xml', async () => {
      const res = await testFunc("SELECT database_to_xml(true, false, '')");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses ts_stat', async () => {
      const res = await testFunc("SELECT * FROM ts_stat('SELECT 1')");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses dblink', async () => {
      const res = await testFunc(
        "SELECT * FROM dblink('host=localhost', 'SELECT 1') AS t(id int)",
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses dblink_exec', async () => {
      const res = await testFunc(
        "SELECT dblink_exec('host=localhost', 'DELETE FROM users')",
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    // State-changing
    it('refuses set_config', async () => {
      const res = await testFunc("SELECT set_config('work_mem', '1GB', false)");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses nextval', async () => {
      const res = await testFunc("SELECT nextval('my_seq')");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses setval', async () => {
      const res = await testFunc("SELECT setval('my_seq', 100)");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses pg_notify', async () => {
      const res = await testFunc("SELECT pg_notify('chan', 'payload')");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses txid_current', async () => {
      const res = await testFunc('SELECT txid_current()');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses pg_current_xact_id', async () => {
      const res = await testFunc('SELECT pg_current_xact_id()');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses lo_create', async () => {
      const res = await testFunc('SELECT lo_create(0)');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses pg_logical_emit_message', async () => {
      const res = await testFunc(
        "SELECT pg_logical_emit_message(true, 'prefix', 'content')",
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses pg_create_logical_replication_slot', async () => {
      const res = await testFunc(
        "SELECT pg_create_logical_replication_slot('slot', 'test_decoding')",
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses pg_advisory_lock', async () => {
      const res = await testFunc('SELECT pg_advisory_lock(123)');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    // Process and server control
    it('refuses pg_sleep', async () => {
      const res = await testFunc('SELECT pg_sleep(5)');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses pg_sleep_for', async () => {
      const res = await testFunc("SELECT pg_sleep_for('5 seconds')");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses pg_sleep_until', async () => {
      const res = await testFunc("SELECT pg_sleep_until('tomorrow')");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses pg_terminate_backend', async () => {
      const res = await testFunc('SELECT pg_terminate_backend(1234)');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses pg_cancel_backend', async () => {
      const res = await testFunc('SELECT pg_cancel_backend(1234)');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses pg_reload_conf', async () => {
      const res = await testFunc('SELECT pg_reload_conf()');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses pg_rotate_logfile', async () => {
      const res = await testFunc('SELECT pg_rotate_logfile()');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses pg_switch_wal', async () => {
      const res = await testFunc('SELECT pg_switch_wal()');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses pg_promote', async () => {
      const res = await testFunc('SELECT pg_promote()');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses pg_backup_start', async () => {
      const res = await testFunc("SELECT pg_backup_start('label')");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    // File system
    it('refuses pg_read_file', async () => {
      const res = await testFunc("SELECT pg_read_file('/etc/passwd')");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses pg_read_binary_file', async () => {
      const res = await testFunc("SELECT pg_read_binary_file('/etc/passwd')");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses pg_ls_dir', async () => {
      const res = await testFunc("SELECT * FROM pg_ls_dir('.')");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses pg_ls_waldir', async () => {
      const res = await testFunc('SELECT * FROM pg_ls_waldir()');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses pg_stat_file', async () => {
      const res = await testFunc("SELECT * FROM pg_stat_file('/etc/passwd')");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });

    it('refuses pg_file_write', async () => {
      const res = await testFunc(
        "SELECT pg_file_write('test.txt', 'hello', false)",
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('PGM-205');
    });
  });

  describe('allowed functions from each category', () => {
    it('allows aggregate count and sum', async () => {
      const res = await testFunc('SELECT count(*), sum(id) FROM users');
      expect(res.ok).toBe(true);
    });

    it('allows window functions rank() and row_number()', async () => {
      const res = await testFunc(
        'SELECT rank() OVER (ORDER BY id), row_number() OVER () FROM users',
      );
      expect(res.ok).toBe(true);
    });

    it('allows math functions abs, round, sin', async () => {
      const res = await testFunc('SELECT abs(-5), round(1.23, 1), sin(0.5)');
      expect(res.ok).toBe(true);
    });

    it('allows string functions length, lower, concat', async () => {
      const res = await testFunc(
        "SELECT length('test'), lower('ABC'), concat('a', 'b')",
      );
      expect(res.ok).toBe(true);
    });

    it('allows date functions now(), date_trunc()', async () => {
      const res = await testFunc("SELECT now(), date_trunc('day', now())");
      expect(res.ok).toBe(true);
    });

    it('allows JSON functions to_json, json_build_object', async () => {
      const res = await testFunc(
        "SELECT to_json(1), json_build_object('a', 1)",
      );
      expect(res.ok).toBe(true);
    });

    it('allows array functions array_length, unnest', async () => {
      const res = await testFunc(
        'SELECT array_length(ARRAY[1,2], 1), unnest(ARRAY[1,2])',
      );
      expect(res.ok).toBe(true);
    });

    it('allows full text functions to_tsvector, to_tsquery', async () => {
      const res = await testFunc(
        "SELECT to_tsvector('hello world'), to_tsquery('hello')",
      );
      expect(res.ok).toBe(true);
    });

    it('allows UUID functions gen_random_uuid', async () => {
      const res = await testFunc('SELECT gen_random_uuid()');
      expect(res.ok).toBe(true);
    });

    it('allows settings functions current_setting, version', async () => {
      const res = await testFunc(
        "SELECT current_setting('server_version'), version()",
      );
      expect(res.ok).toBe(true);
    });
  });

  describe('qualification and case sensitivity rules', () => {
    it('allows qualified pg_catalog.now()', async () => {
      const res = await testFunc('SELECT pg_catalog.now()');
      expect(res.ok).toBe(true);
    });

    it('allows uppercase unquoted NOW()', async () => {
      const res = await testFunc('SELECT NOW()');
      expect(res.ok).toBe(true);
    });

    it('refuses quoted mixed-case "Now"()', async () => {
      const res = await testFunc('SELECT "Now"()');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('PGM-205');
        expect(res.message).toContain('Function "Now" is not allowed');
      }
    });

    it('allows user-configured function from policy.allowed_functions', async () => {
      const config: Partial<PgmoatConfigT> = {
        policy: {
          allowed_functions: ['public.business_days'],
          allow_catalog_queries: false,
          strict_unqualified_columns: true,
        },
      };
      const res = await testFunc('SELECT public.business_days(now())', config);
      expect(res.ok).toBe(true);
    });

    it('refuses unconfigured qualified function', async () => {
      const res = await testFunc('SELECT public.secret_proc()');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('PGM-205');
        expect(res.message).toContain(
          'Function "public.secret_proc" is not allowed',
        );
      }
    });

    it('refuses user-allowed never-allowed function (override forbidden)', async () => {
      const config: Partial<PgmoatConfigT> = {
        policy: {
          allowed_functions: [
            'public.pg_sleep',
            'pg_catalog.pg_sleep',
            'pg_sleep',
          ],
          allow_catalog_queries: false,
          strict_unqualified_columns: true,
        },
      };
      const res = await testFunc('SELECT public.pg_sleep(1)', config);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('PGM-205');
      }
    });

    it('allows functions in FROM (generate_series, json_each)', async () => {
      const res1 = await testFunc('SELECT * FROM generate_series(1, 10)');
      expect(res1.ok).toBe(true);

      const res2 = await testFunc('SELECT * FROM json_each(\'{"a": 1}\')');
      expect(res2.ok).toBe(true);
    });

    it('refuses disallowed functions in FROM (pg_ls_dir)', async () => {
      const res = await testFunc("SELECT * FROM pg_ls_dir('.')");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('PGM-205');
      }
    });
  });
});
