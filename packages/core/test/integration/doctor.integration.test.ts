import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import {
  startPostgres,
  connectionUrl,
  stopPostgres,
} from './harness/postgres.js';
import { createPools, type Pools } from '../../src/postgres/pool.js';
import { introspect, type IntrospectionResult } from '../../src/postgres/introspect.js';
import { runDoctor, quoteIdent, quoteQualified } from '../../src/postgres/doctor.js';
import { buildZeroConfig } from '../../src/config/defaults.js';

describe('Postgres Doctor Preflight Checks (P3.6)', () => {
  let readerPools: Pools;
  let adminClient: pg.Client;
  let baseIntrospection: IntrospectionResult;

  beforeAll(async () => {
    await startPostgres();

    adminClient = new pg.Client({ connectionString: connectionUrl('postgres') });
    await adminClient.connect();

    readerPools = createPools({
      connection: {
        url: connectionUrl('pgmoat_reader'),
        schemas: ['public'],
        application_name: 'test-doctor-reader',
        pool: { min: 1, max: 5, acquire_timeout_ms: 3000 },
      },
    });

    baseIntrospection = await introspect(readerPools, ['public']);
  }, 60000);

  afterAll(async () => {
    await readerPools?.end();
    await adminClient?.end();
    await stopPostgres();
  });

  it('quotes identifiers and qualified names correctly', () => {
    expect(quoteIdent('users')).toBe('"users"');
    expect(quoteIdent('bad"name')).toBe('"bad""name"');
    expect(quoteQualified('public', 'users')).toBe('"public"."users"');
    expect(quoteQualified('sch"1', 'tbl"2')).toBe('"sch""1"."tbl""2"');
  });

  it('reader role with proper grants passes with zero fail/warn findings', async () => {
    const config = buildZeroConfig(connectionUrl('pgmoat_reader'));
    config.rls.protected_tables = ['orders', 'tickets', 'customers'];
    config.tables = {
      users: {
        description: 'Users table',
        hidden: false,
        sensitive_columns: [],
        columns: {
          password_hash: { hidden: true, untrusted: false },
          mfa_secret: { hidden: true, untrusted: false },
        },
        relationships: [],
        write: [],
        update_columns: [],
        insert_required_columns: [],
        insert_defaults: {},
        max_affected_rows: 100,
      },
    };

    const findings = await runDoctor(readerPools, config, baseIntrospection);
    const failOrWarn = findings.filter((f) => f.severity === 'fail' || f.severity === 'warn');
    expect(failOrWarn).toHaveLength(0);
  });

  it('PGM-701: superuser role returns fail finding with fix', async () => {
    const config = buildZeroConfig(connectionUrl('postgres'));
    const findings = await runDoctor(adminClient, config, baseIntrospection);

    const f701 = findings.find((f) => f.code === 'PGM-701');
    expect(f701).toBeDefined();
    expect(f701?.severity).toBe('fail');
    expect(f701?.subject).toBe('role postgres');
    expect(f701?.message).toContain('is a superuser');
    expect(f701?.fix).toContain('ALTER ROLE "postgres" NOSUPERUSER;');
  });

  it('PGM-702: BYPASSRLS role returns fail when RLS is configured, info when RLS is unconfigured', async () => {
    const bypassClient = new pg.Client({ connectionString: connectionUrl('pgmoat_bypass') });
    await bypassClient.connect();

    try {
      // 1. With RLS configured
      const configWithRls = buildZeroConfig(connectionUrl('pgmoat_bypass'));
      configWithRls.rls.protected_tables = ['orders'];

      const findingsWithRls = await runDoctor(bypassClient, configWithRls, baseIntrospection);
      const f702Fail = findingsWithRls.find((f) => f.code === 'PGM-702');
      expect(f702Fail).toBeDefined();
      expect(f702Fail?.severity).toBe('fail');
      expect(f702Fail?.subject).toBe('role pgmoat_bypass');
      expect(f702Fail?.fix).toBe('ALTER ROLE "pgmoat_bypass" NOBYPASSRLS;');

      // 2. Without RLS configured
      const configNoRls = buildZeroConfig(connectionUrl('pgmoat_bypass'));
      configNoRls.rls.protected_tables = [];
      configNoRls.rls.session_variables = {};
      configNoRls.rls.required = false;

      const findingsNoRls = await runDoctor(bypassClient, configNoRls, baseIntrospection);
      const f702Info = findingsNoRls.find((f) => f.code === 'PGM-702');
      expect(f702Info).toBeDefined();
      expect(f702Info?.severity).toBe('info');
    } finally {
      await bypassClient.end();
    }
  });

  it('PGM-703: role owning protected table without FORCE ROW LEVEL SECURITY returns fail', async () => {
    const ownerClient = new pg.Client({ connectionString: connectionUrl('pgmoat_owner_like') });
    await ownerClient.connect();

    try {
      // Temporarily disable FORCE on orders (orders is owned by pgmoat_owner_like)
      await adminClient.query('ALTER TABLE orders NO FORCE ROW LEVEL SECURITY');

      const intro = await introspect(ownerClient, ['public']);
      const config = buildZeroConfig(connectionUrl('pgmoat_owner_like'));
      config.rls.protected_tables = ['orders'];

      const findings = await runDoctor(ownerClient, config, intro);
      const f703 = findings.find((f) => f.code === 'PGM-703');
      expect(f703).toBeDefined();
      expect(f703?.severity).toBe('fail');
      expect(f703?.subject).toBe('public.orders');
      expect(f703?.fix).toBe('ALTER TABLE "public"."orders" FORCE ROW LEVEL SECURITY;');
    } finally {
      await adminClient.query('ALTER TABLE orders FORCE ROW LEVEL SECURITY');
      await ownerClient.end();
    }
  });

  it('PGM-704: protected table with RLS disabled returns fail', async () => {
    try {
      // Temporarily disable RLS on tickets
      await adminClient.query('ALTER TABLE tickets DISABLE ROW LEVEL SECURITY');

      const intro = await introspect(readerPools, ['public']);
      const config = buildZeroConfig(connectionUrl('pgmoat_reader'));
      config.rls.protected_tables = ['tickets'];

      const findings = await runDoctor(readerPools, config, intro);
      const f704 = findings.find((f) => f.code === 'PGM-704');
      expect(f704).toBeDefined();
      expect(f704?.severity).toBe('fail');
      expect(f704?.subject).toBe('public.tickets');
      expect(f704?.fix).toBe('ALTER TABLE "public"."tickets" ENABLE ROW LEVEL SECURITY;');
    } finally {
      await adminClient.query('ALTER TABLE tickets ENABLE ROW LEVEL SECURITY');
    }
  });

  it('PGM-705: role can SELECT a hidden column returns warn with revoke fix', async () => {
    const config = buildZeroConfig(connectionUrl('pgmoat_reader'));
    config.tables = {
      users: {
        description: 'Users table',
        hidden: false,
        sensitive_columns: [],
        columns: {
          email: { hidden: true, untrusted: false }, // reader HAS SELECT on email
        },
        relationships: [],
        write: [],
        update_columns: [],
        insert_required_columns: [],
        insert_defaults: {},
        max_affected_rows: 100,
      },
    };

    const findings = await runDoctor(readerPools, config, baseIntrospection);
    const f705 = findings.find((f) => f.code === 'PGM-705');
    expect(f705).toBeDefined();
    expect(f705?.severity).toBe('warn');
    expect(f705?.subject).toBe('public.users.email');
    expect(f705?.fix).toBe('REVOKE SELECT ("email") ON "public"."users" FROM "pgmoat_reader";');
  });

  it('PGM-705: fast mode skips per-column checks when hidden columns exceed 500', async () => {
    const config = buildZeroConfig(connectionUrl('pgmoat_reader'));
    // Generate 501 mock hidden columns
    const mockHidden = Array.from({ length: 501 }, (_, i) => ({
      schema: 'public',
      table: 'users',
      column: `col_${i}`,
    }));

    const findings = await runDoctor(readerPools, config, baseIntrospection, mockHidden);
    const f705 = findings.find((f) => f.code === 'PGM-705');
    expect(f705).toBeDefined();
    expect(f705?.severity).toBe('info');
    expect(f705?.message).toContain('501 hidden columns exceeds cap of 500');
  });

  it('PGM-706: role with write privileges in read-only mode returns warn', async () => {
    const writerClient = new pg.Client({ connectionString: connectionUrl('pgmoat_writer') });
    await writerClient.connect();

    try {
      const config = buildZeroConfig(connectionUrl('pgmoat_writer'));
      config.mode = 'read-only';

      const findings = await runDoctor(writerClient, config, baseIntrospection);
      const f706s = findings.filter((f) => f.code === 'PGM-706');
      expect(f706s.length).toBeGreaterThan(0);

      const ordersFinding = f706s.find((f) => f.subject === 'public.orders');
      expect(ordersFinding).toBeDefined();
      expect(ordersFinding?.severity).toBe('warn');
      expect(ordersFinding?.fix).toBe(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "public"."orders" FROM "pgmoat_writer";',
      );

      // In scoped-write mode, PGM-706 is not emitted
      config.mode = 'scoped-write';
      const findingsScoped = await runDoctor(writerClient, config, baseIntrospection);
      const f706Scoped = findingsScoped.filter((f) => f.code === 'PGM-706');
      expect(f706Scoped).toHaveLength(0);
    } finally {
      await writerClient.end();
    }
  });

  it('PGM-707: server version outside 15..18 returns warn', async () => {
    const config = buildZeroConfig(connectionUrl('pgmoat_reader'));
    const oldIntro: IntrospectionResult = {
      ...baseIntrospection,
      serverVersionNum: 140008, // PG 14
    };

    const findings = await runDoctor(readerPools, config, oldIntro);
    const f707 = findings.find((f) => f.code === 'PGM-707');
    expect(f707).toBeDefined();
    expect(f707?.severity).toBe('warn');
    expect(f707?.subject).toBe('Postgres server 14');
    expect(f707?.message).toContain('140008');
  });
});
