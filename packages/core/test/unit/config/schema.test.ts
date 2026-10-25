import { describe, it, expect } from 'vitest';
import {
  PgmoatConfig,
  RlsSource,
  PgSetting,
} from '../../../src/config/schema.js';
import { buildZeroConfig } from '../../../src/config/defaults.js';

describe('PgmoatConfig schema', () => {
  const minimalConfig = {
    version: 1,
    server: {
      name: 'pgmoat-test',
    },
    connection: {
      url: 'postgresql://postgres:postgres@localhost:5432/test',
    },
  };

  it('parses minimal config and yields the complete default tree', () => {
    const parsed = PgmoatConfig.parse(minimalConfig);

    expect(parsed.version).toBe(1);
    expect(parsed.server.name).toBe('pgmoat-test');
    expect(parsed.server.description).toBe('');
    expect(parsed.transport).toBe('stdio');
    expect(parsed.mode).toBe('read-only');

    // Budgets defaults from spec/05
    expect(parsed.budgets.max_rows).toBe(200);
    expect(parsed.budgets.max_query_ms).toBe(5000);
    expect(parsed.budgets.max_explain_ms).toBe(500);
    expect(parsed.budgets.lock_timeout_ms).toBe(1000);
    expect(parsed.budgets.max_columns).toBe(50);
    expect(parsed.budgets.max_payload_bytes).toBe(65536);
    expect(parsed.budgets.max_cell_chars).toBe(500);
    expect(parsed.budgets.max_sql_chars).toBe(65536);
    expect(parsed.budgets.offset_warning).toBe(10000);

    // Pool defaults
    expect(parsed.connection.schemas).toEqual(['public']);
    expect(parsed.connection.pool.min).toBe(1);
    expect(parsed.connection.pool.max).toBe(10);
    expect(parsed.connection.pool.acquire_timeout_ms).toBe(3000);

    // Audit default: file with redact lists
    expect(parsed.audit.destination).toBe('file');
    expect(parsed.audit.redact_in_sql).toBe(true);
    expect(parsed.audit.redact_fields).toContain('password');
    expect(parsed.audit.redact_fields).toContain('token');
    expect(parsed.audit.redact_fields).toContain('api_key');
    expect(parsed.audit.buffer_max_bytes).toBe(10485760);
    expect(parsed.audit.flush_interval_ms).toBe(100);

    // RLS and policy
    expect(parsed.rls.required).toBe(false);
    expect(parsed.rls.trust_request_meta).toBe(false);
    expect(parsed.policy.allow_catalog_queries).toBe(false);
    expect(parsed.policy.strict_unqualified_columns).toBe(true);

    // Doctor
    expect(parsed.doctor.on_start).toBe('enforce');
  });

  it('buildZeroConfig sets doctor.on_start to warn', () => {
    const zero = buildZeroConfig('postgresql://localhost/app');
    expect(zero.doctor.on_start).toBe('warn');
    expect(zero.connection.url).toBe('postgresql://localhost/app');
    expect(zero.server.name).toBe('pgmoat');
    expect(zero.mode).toBe('read-only');
    expect(zero.budgets.max_rows).toBe(200);
  });

  it('rejects invalid enums', () => {
    expect(() =>
      PgmoatConfig.parse({ ...minimalConfig, transport: 'grpc' }),
    ).toThrow();
    expect(() =>
      PgmoatConfig.parse({ ...minimalConfig, mode: 'full-write' }),
    ).toThrow();
    expect(() =>
      PgmoatConfig.parse({
        ...minimalConfig,
        doctor: { on_start: 'ignore' },
      }),
    ).toThrow();
  });

  it('validates server.name regex', () => {
    // Valid names
    expect(
      PgmoatConfig.parse({
        ...minimalConfig,
        server: { name: 'valid-name-123' },
      }).server.name,
    ).toBe('valid-name-123');

    // Invalid names
    expect(() =>
      PgmoatConfig.parse({
        ...minimalConfig,
        server: { name: '-invalid' },
      }),
    ).toThrow();
    expect(() =>
      PgmoatConfig.parse({
        ...minimalConfig,
        server: { name: 'Invalid_Caps' },
      }),
    ).toThrow();
    expect(() =>
      PgmoatConfig.parse({
        ...minimalConfig,
        server: { name: 'a'.repeat(64) },
      }),
    ).toThrow();
  });

  it('validates RlsSource regex', () => {
    // Valid sources
    expect(RlsSource.parse('token.tenant_id')).toBe('token.tenant_id');
    expect(RlsSource.parse('env.APP_TENANT_ID')).toBe('env.APP_TENANT_ID');
    expect(RlsSource.parse('static:tenant-123')).toBe('static:tenant-123');
    expect(RlsSource.parse('meta.tenant_key')).toBe('meta.tenant_key');

    // Invalid sources
    expect(() => RlsSource.parse('header.tenant_id')).toThrow();
    expect(() => RlsSource.parse('token.')).toThrow();
    expect(() => RlsSource.parse('env.lowercase')).toThrow();
    expect(() => RlsSource.parse('static:')).toThrow();
  });

  it('validates PgSetting requires prefix and dot', () => {
    expect(PgSetting.parse('app.tenant_id')).toBe('app.tenant_id');
    expect(PgSetting.parse('request.jwt.claim')).toBe('request.jwt.claim');

    expect(() => PgSetting.parse('nodot')).toThrow();
    expect(() => PgSetting.parse('.leadingdot')).toThrow();
    expect(() => PgSetting.parse('trailingdot.')).toThrow();
  });

  it('rejects unknown keys due to strict mode', () => {
    expect(() =>
      PgmoatConfig.parse({
        ...minimalConfig,
        unknown_top_level_key: true,
      }),
    ).toThrow();

    expect(() =>
      PgmoatConfig.parse({
        ...minimalConfig,
        server: {
          name: 'test',
          extra: 'bad',
        },
      }),
    ).toThrow();
  });
});
