import { describe, it, expect } from 'vitest';
import { resolveRls, META_RLS_KEY } from '../../../src/rls/resolve.js';
import { isPgmoatError } from '../../../src/errors.js';

describe('RLS Resolver (P3.5)', () => {
  it('resolves static, env, token, and meta sources', () => {
    const res = resolveRls({
      rls: {
        required: true,
        trust_request_meta: true,
        protected_tables: [],
        session_variables: {
          'app.static_val': 'static:support-agent',
          'app.env_val': 'env.TEST_REGION',
          'app.token_val': 'token.sub',
          'app.meta_val': 'meta.tenant_id',
        },
      },
      transport: 'stdio',
      principal: {
        claims: { sub: 'usr_123' },
      },
      meta: {
        [META_RLS_KEY]: { tenant_id: 'tnt_abc' },
      },
      env: {
        TEST_REGION: 'us-east-1',
      },
    });

    expect(res.entries).toEqual([
      ['app.static_val', 'support-agent'],
      ['app.env_val', 'us-east-1'],
      ['app.token_val', 'usr_123'],
      ['app.meta_val', 'tnt_abc'],
    ]);

    expect(res.sources).toEqual({
      'app.static_val': 'static',
      'app.env_val': 'env',
      'app.token_val': 'token',
      'app.meta_val': 'meta',
    });
  });

  it('resolves nested token claims with dot paths', () => {
    const res = resolveRls({
      rls: {
        required: true,
        trust_request_meta: false,
        protected_tables: [],
        session_variables: {
          'app.org_id': 'token.organization.id',
          'app.dept_code': 'token.dept.code',
        },
      },
      transport: 'http',
      principal: {
        claims: {
          organization: { id: 'org_999' },
          dept: { code: 'ENG' },
        },
      },
    });

    expect(res.entries).toEqual([
      ['app.org_id', 'org_999'],
      ['app.dept_code', 'ENG'],
    ]);
  });

  it('refuses untrusted meta over HTTP with PGM-404', () => {
    expect(() =>
      resolveRls({
        rls: {
          required: false,
          trust_request_meta: false,
          protected_tables: [],
          session_variables: {},
        },
        transport: 'http',
        meta: {
          [META_RLS_KEY]: { tenant_id: 'tnt_spoof' },
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'PGM-404',
      }),
    );
  });

  it('refuses untrusted meta in stdio when trust_request_meta is false', () => {
    expect(() =>
      resolveRls({
        rls: {
          required: false,
          trust_request_meta: false,
          protected_tables: [],
          session_variables: {},
        },
        transport: 'stdio',
        meta: {
          [META_RLS_KEY]: { tenant_id: 'tnt_spoof' },
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'PGM-404',
      }),
    );
  });

  it('refuses missing token claim with PGM-405 when required', () => {
    let err: unknown;
    try {
      resolveRls({
        rls: {
          required: true,
          trust_request_meta: false,
          protected_tables: [],
          session_variables: {
            'app.tenant_id': 'token.tenant_id',
          },
        },
        transport: 'http',
        principal: {
          claims: { other: 'claim' },
        },
      });
    } catch (e) {
      err = e;
    }

    expect(isPgmoatError(err)).toBe(true);
    if (isPgmoatError(err)) {
      expect(err.code).toBe('PGM-405');
    }
  });

  it('refuses missing env var with PGM-401 when required', () => {
    let err: unknown;
    try {
      resolveRls({
        rls: {
          required: true,
          trust_request_meta: false,
          protected_tables: [],
          session_variables: {
            'app.region': 'env.MISSING_ENV_VAR',
          },
        },
        transport: 'stdio',
        env: {},
      });
    } catch (e) {
      err = e;
    }

    expect(isPgmoatError(err)).toBe(true);
    if (isPgmoatError(err)) {
      expect(err.code).toBe('PGM-401');
    }
  });

  it('skips missing values when required is false', () => {
    const res = resolveRls({
      rls: {
        required: false,
        trust_request_meta: false,
        protected_tables: [],
        session_variables: {
          'app.missing_token': 'token.missing',
          'app.missing_env': 'env.MISSING_ENV',
          'app.present': 'static:ok',
        },
      },
      transport: 'http',
      principal: { claims: {} },
      env: {},
    });

    expect(res.entries).toEqual([['app.present', 'ok']]);
    expect(res.sources).toEqual({ 'app.present': 'static' });
  });

  it('refuses non-scalar values (arrays and objects) with PGM-403', () => {
    // Array
    expect(() =>
      resolveRls({
        rls: {
          required: false,
          trust_request_meta: false,
          protected_tables: [],
          session_variables: {
            'app.roles': 'token.roles',
          },
        },
        transport: 'http',
        principal: {
          claims: { roles: ['admin', 'user'] },
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'PGM-403',
      }),
    );

    // Object
    expect(() =>
      resolveRls({
        rls: {
          required: false,
          trust_request_meta: false,
          protected_tables: [],
          session_variables: {
            'app.user': 'token.user',
          },
        },
        transport: 'http',
        principal: {
          claims: { user: { name: 'Alice' } },
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'PGM-403',
      }),
    );
  });

  it('refuses empty string values with PGM-403', () => {
    expect(() =>
      resolveRls({
        rls: {
          required: false,
          trust_request_meta: false,
          protected_tables: [],
          session_variables: {
            'app.tenant_id': 'token.tenant_id',
          },
        },
        transport: 'http',
        principal: {
          claims: { tenant_id: '   ' },
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'PGM-403',
      }),
    );
  });

  it('converts numbers and booleans (including 0 and false) to strings', () => {
    const res = resolveRls({
      rls: {
        required: true,
        trust_request_meta: false,
        protected_tables: [],
        session_variables: {
          'app.zero_num': 'token.zero',
          'app.false_bool': 'token.flag',
          'app.positive_num': 'token.count',
        },
      },
      transport: 'http',
      principal: {
        claims: {
          zero: 0,
          flag: false,
          count: 42,
        },
      },
    });

    expect(res.entries).toEqual([
      ['app.zero_num', '0'],
      ['app.false_bool', 'false'],
      ['app.positive_num', '42'],
    ]);
  });

  it('preserves configuration order of session variables', () => {
    const res = resolveRls({
      rls: {
        required: true,
        trust_request_meta: false,
        protected_tables: [],
        session_variables: {
          'app.z_last': 'static:3',
          'app.a_first': 'static:1',
          'app.m_middle': 'static:2',
        },
      },
      transport: 'stdio',
    });

    expect(res.entries).toEqual([
      ['app.z_last', '3'],
      ['app.a_first', '1'],
      ['app.m_middle', '2'],
    ]);
  });
});

