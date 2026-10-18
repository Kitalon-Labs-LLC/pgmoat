import { describe, it, expect } from 'vitest';
import { PgmoatConfig } from '../../../src/config/schema.js';
import { checkConfig } from '../../../src/config/checks.js';

describe('checkConfig cross-field validation', () => {
  const baseValidConfig = () => ({
    version: 1 as const,
    server: { name: 'test-server' },
    connection: { url: 'postgresql://localhost/db' },
  });

  it('validates clean default config produces no errors or warnings', () => {
    const cfg = PgmoatConfig.parse(baseValidConfig());
    const res = checkConfig(cfg);
    expect(res.errors).toHaveLength(0);
    expect(res.warnings).toHaveLength(0);
  });

  it('PGM-102: refuses mode: scoped-write in v1.0', () => {
    const cfg = PgmoatConfig.parse({
      ...baseValidConfig(),
      mode: 'scoped-write',
    });
    const res = checkConfig(cfg);
    expect(res.errors.some((e) => e.code === 'PGM-102')).toBe(true);
  });

  it('PGM-103: refuses update_columns without update in write', () => {
    // Failing
    const failing = PgmoatConfig.parse({
      ...baseValidConfig(),
      tables: {
        users: {
          update_columns: ['name'],
          write: ['insert'],
        },
      },
    });
    expect(
      checkConfig(failing).errors.some((e) => e.code === 'PGM-103'),
    ).toBe(true);

    // Passing
    const passing = PgmoatConfig.parse({
      ...baseValidConfig(),
      tables: {
        users: {
          update_columns: ['name'],
          write: ['update'],
        },
      },
    });
    expect(
      checkConfig(passing).errors.some((e) => e.code === 'PGM-103'),
    ).toBe(false);
  });

  it('PGM-105: refuses rls.required without session_variables', () => {
    // Failing
    const failing = PgmoatConfig.parse({
      ...baseValidConfig(),
      rls: { required: true, session_variables: {} },
    });
    expect(
      checkConfig(failing).errors.some((e) => e.code === 'PGM-105'),
    ).toBe(true);

    // Passing
    const passing = PgmoatConfig.parse({
      ...baseValidConfig(),
      rls: {
        required: true,
        session_variables: { 'app.tenant': 'env.TENANT_ID' },
      },
    });
    expect(
      checkConfig(passing).errors.some((e) => e.code === 'PGM-105'),
    ).toBe(false);
  });

  it('PGM-106: refuses pool.max < pool.min', () => {
    // Failing
    const failing = PgmoatConfig.parse({
      ...baseValidConfig(),
      connection: {
        url: 'postgresql://localhost/db',
        pool: { min: 10, max: 2 },
      },
    });
    expect(
      checkConfig(failing).errors.some((e) => e.code === 'PGM-106'),
    ).toBe(true);

    // Passing
    const passing = PgmoatConfig.parse({
      ...baseValidConfig(),
      connection: {
        url: 'postgresql://localhost/db',
        pool: { min: 2, max: 10 },
      },
    });
    expect(
      checkConfig(passing).errors.some((e) => e.code === 'PGM-106'),
    ).toBe(false);
  });

  it('PGM-111: refuses audit.destination: stdout with transport: stdio', () => {
    // Failing
    const failing = PgmoatConfig.parse({
      ...baseValidConfig(),
      transport: 'stdio',
      audit: { destination: 'stdout' },
    });
    expect(
      checkConfig(failing).errors.some((e) => e.code === 'PGM-111'),
    ).toBe(true);

    // Passing
    const passing = PgmoatConfig.parse({
      ...baseValidConfig(),
      transport: 'stdio',
      audit: { destination: 'stderr' },
    });
    expect(
      checkConfig(passing).errors.some((e) => e.code === 'PGM-111'),
    ).toBe(false);
  });

  it('PGM-112: refuses meta.* RLS source without stdio and trust_request_meta', () => {
    // Failing 1: http transport
    const failingHttp = PgmoatConfig.parse({
      ...baseValidConfig(),
      transport: 'http',
      rls: {
        trust_request_meta: true,
        session_variables: { 'app.tenant': 'meta.tenant_id' },
      },
    });
    expect(
      checkConfig(failingHttp).errors.some((e) => e.code === 'PGM-112'),
    ).toBe(true);

    // Failing 2: stdio but trust_request_meta: false
    const failingUntrusted = PgmoatConfig.parse({
      ...baseValidConfig(),
      transport: 'stdio',
      rls: {
        trust_request_meta: false,
        session_variables: { 'app.tenant': 'meta.tenant_id' },
      },
    });
    expect(
      checkConfig(failingUntrusted).errors.some((e) => e.code === 'PGM-112'),
    ).toBe(true);

    // Passing
    const passing = PgmoatConfig.parse({
      ...baseValidConfig(),
      transport: 'stdio',
      rls: {
        trust_request_meta: true,
        session_variables: { 'app.tenant': 'meta.tenant_id' },
      },
    });
    expect(
      checkConfig(passing).errors.some((e) => e.code === 'PGM-112'),
    ).toBe(false);
  });

  it('PGM-113: refuses token.* RLS source without HTTP OAuth', () => {
    // Failing on stdio
    const failingStdio = PgmoatConfig.parse({
      ...baseValidConfig(),
      transport: 'stdio',
      rls: {
        session_variables: { 'app.tenant': 'token.sub' },
      },
    });
    expect(
      checkConfig(failingStdio).errors.some((e) => e.code === 'PGM-113'),
    ).toBe(true);

    // Passing on http with oauth
    const passing = PgmoatConfig.parse({
      ...baseValidConfig(),
      transport: 'http',
      http: {
        host: '127.0.0.1',
        public_url: 'https://mcp.example.com',
      },
      auth: {
        mode: 'oauth',
        issuer: 'https://auth.example.com',
        audience: 'https://mcp.example.com',
        jwks_url: 'https://auth.example.com/.well-known/jwks.json',
      },
      rls: {
        session_variables: { 'app.tenant': 'token.sub' },
      },
    });
    expect(
      checkConfig(passing).errors.some((e) => e.code === 'PGM-113'),
    ).toBe(false);
  });

  it('PGM-114: refuses non-loopback HTTP bind without auth', () => {
    // Failing
    const failing = PgmoatConfig.parse({
      ...baseValidConfig(),
      transport: 'http',
      http: { host: '0.0.0.0' },
      auth: { mode: 'none' },
    });
    expect(
      checkConfig(failing).errors.some((e) => e.code === 'PGM-114'),
    ).toBe(true);

    // Passing with loopback
    const passingLoopback = PgmoatConfig.parse({
      ...baseValidConfig(),
      transport: 'http',
      http: { host: '127.0.0.1' },
      auth: { mode: 'none' },
    });
    expect(
      checkConfig(passingLoopback).errors.some((e) => e.code === 'PGM-114'),
    ).toBe(false);
  });

  it('PGM-116: refuses incomplete OAuth configuration', () => {
    // Failing: missing jwks_url and public_url
    const failing = PgmoatConfig.parse({
      ...baseValidConfig(),
      transport: 'http',
      auth: {
        mode: 'oauth',
        issuer: 'https://auth.example.com',
        audience: 'https://mcp.example.com',
      },
    });
    expect(
      checkConfig(failing).errors.some((e) => e.code === 'PGM-116'),
    ).toBe(true);

    // Passing
    const passing = PgmoatConfig.parse({
      ...baseValidConfig(),
      transport: 'http',
      http: { public_url: 'https://mcp.example.com' },
      auth: {
        mode: 'oauth',
        issuer: 'https://auth.example.com',
        audience: 'https://mcp.example.com',
        jwks_url: 'https://auth.example.com/.well-known/jwks.json',
      },
    });
    expect(
      checkConfig(passing).errors.some((e) => e.code === 'PGM-116'),
    ).toBe(false);
  });

  it('PGM-117: warns on audience mismatch (error if strict)', () => {
    const configWithMismatch = PgmoatConfig.parse({
      ...baseValidConfig(),
      transport: 'http',
      http: { public_url: 'https://mcp.example.com' },
      auth: {
        mode: 'oauth',
        issuer: 'https://auth.example.com',
        audience: 'https://different.example.com',
        jwks_url: 'https://auth.example.com/.well-known/jwks.json',
      },
    });

    // Default (non-strict): warning
    const nonStrict = checkConfig(configWithMismatch, { strict: false });
    expect(nonStrict.errors).toHaveLength(0);
    expect(nonStrict.warnings.some((w) => w.code === 'PGM-117')).toBe(true);

    // Strict: error
    const strict = checkConfig(configWithMismatch, { strict: true });
    expect(strict.errors.some((e) => e.code === 'PGM-117')).toBe(true);
  });
});
