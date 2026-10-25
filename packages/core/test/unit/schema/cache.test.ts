import { describe, it, expect, vi } from 'vitest';
import { SchemaCache } from '../../../src/schema/cache.js';
import { PgmoatConfig } from '../../../src/config/schema.js';
import type { IntrospectionResult, RawRelationInfo } from '../../../src/postgres/introspect.js';

function createSyntheticIntrospection(version = 1): IntrospectionResult {
  const users: RawRelationInfo = {
    oid: 1001,
    schema: 'public',
    name: 'users',
    kind: 'r',
    kindName: 'table',
    description: `Users v${version}`,
    rowEstimate: 100 * version,
    relrowsecurity: true,
    relforcerowsecurity: false,
    owner: 'postgres',
    columns: [
      {
        name: 'id',
        type: 'uuid',
        notNull: true,
        default: 'gen_random_uuid()',
        ordinal: 1,
        description: null,
      },
      {
        name: 'email',
        type: 'text',
        notNull: true,
        default: null,
        ordinal: 2,
        description: null,
      },
    ],
    primaryKey: ['id'],
    uniqueKeys: [['email']],
    foreignKeys: [],
    indexes: [
      {
        name: 'users_pkey',
        columns: ['id'],
        unique: true,
        primary: true,
        definition: 'CREATE UNIQUE INDEX users_pkey ON users(id)',
      },
    ],
  };

  return {
    serverVersionNum: 170000,
    currentUser: 'pgmoat_reader',
    relations: [users],
  };
}

describe('SchemaCache', () => {
  const baseConfig = PgmoatConfig.parse({
    version: 1,
    server: { name: 'test-server' },
    connection: { url: 'postgresql://readonly@localhost/db', schemas: ['public'] },
    schema: { cache_ttl_s: 60 },
  });

  it('returns initial snapshot immediately without calling introspect when fresh', () => {
    let introspectCalls = 0;
    const introspect = async () => {
      introspectCalls++;
      return createSyntheticIntrospection(1);
    };

    let now = 10_000;
    const clock = () => now;

    const cache = new SchemaCache({
      config: baseConfig,
      introspect,
      clock,
      initialIntrospection: createSyntheticIntrospection(1),
    });

    const s1 = cache.get();
    expect(s1.relations[0]?.description).toBe('Users v1');
    expect(introspectCalls).toBe(0);

    // Advance time within TTL
    now += 30_000;
    const s2 = cache.get();
    expect(s2).toBe(s1);
    expect(introspectCalls).toBe(0);
  });

  it('triggers only one refresh under concurrent gets after TTL expiry', async () => {
    let introspectCalls = 0;
    let resolveIntrospect: (val: IntrospectionResult) => void;

    const introspect = vi.fn().mockImplementation(() => {
      introspectCalls++;
      return new Promise<IntrospectionResult>((resolve) => {
        resolveIntrospect = resolve;
      });
    });

    let now = 10_000;
    const clock = () => now;

    const cache = new SchemaCache({
      config: baseConfig,
      introspect,
      clock,
      ttlMs: 60_000,
      initialIntrospection: createSyntheticIntrospection(1),
    });

    // Advance time past TTL
    now += 60_001;

    // Multiple concurrent gets
    const s1 = cache.get();
    const s2 = cache.get();
    const s3 = cache.get();

    // Stale-while-revalidate: all return previous snapshot immediately
    expect(s1.relations[0]?.description).toBe('Users v1');
    expect(s2.relations[0]?.description).toBe('Users v1');
    expect(s3.relations[0]?.description).toBe('Users v1');

    // Single flight: only 1 introspect call initiated
    expect(introspectCalls).toBe(1);
    expect(cache.isRefreshing).toBe(true);

    // Another get while in-flight still doesn't trigger another refresh
    cache.get();
    expect(introspectCalls).toBe(1);

    // Resolve in-flight introspect
    resolveIntrospect!(createSyntheticIntrospection(2));
    await cache.waitForRefresh();

    expect(cache.isRefreshing).toBe(false);

    // Next get returns the new snapshot
    const sUpdated = cache.get();
    expect(sUpdated.relations[0]?.description).toBe('Users v2');
    expect(introspectCalls).toBe(1);
  });

  it('on refresh failure: keeps old snapshot, logs warning, and retries at next TTL', async () => {
    let introspectCalls = 0;
    const warnings: string[] = [];

    const introspect = vi.fn().mockImplementation(async () => {
      introspectCalls++;
      throw new Error('Database connection refused');
    });

    let now = 10_000;
    const clock = () => now;

    const cache = new SchemaCache({
      config: baseConfig,
      introspect,
      clock,
      ttlMs: 60_000,
      onWarning: (msg) => {
        warnings.push(msg);
      },
      initialIntrospection: createSyntheticIntrospection(1),
    });

    // Advance past TTL
    now += 60_001;

    // Triggers background refresh that will fail
    const sBefore = cache.get();
    expect(sBefore.relations[0]?.description).toBe('Users v1');
    expect(introspectCalls).toBe(1);

    // Wait for the background failure to be handled
    await cache.waitForRefresh();

    // Old snapshot is preserved
    const sAfter = cache.get();
    expect(sAfter.relations[0]?.description).toBe('Users v1');
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('Database connection refused');

    // Should NOT retry immediately on next call (does not spin)
    cache.get();
    cache.get();
    expect(introspectCalls).toBe(1);

    // Retries at next TTL
    now += 60_001;
    cache.get();
    expect(introspectCalls).toBe(2);
    await cache.waitForRefresh();
    expect(warnings.length).toBe(2);
  });

  it('applyAnnotations rebuilds snapshot from last introspection without database hit', () => {
    let introspectCalls = 0;
    const introspect = async () => {
      introspectCalls++;
      return createSyntheticIntrospection(1);
    };

    const now = 10_000;
    const clock = () => now;

    const cache = new SchemaCache({
      config: baseConfig,
      introspect,
      clock,
      initialIntrospection: createSyntheticIntrospection(1),
    });

    expect(cache.get().relations[0]?.description).toBe('Users v1');
    expect(introspectCalls).toBe(0);

    // Update config with table annotation (as in --watch)
    const newConfig = PgmoatConfig.parse({
      ...baseConfig,
      tables: {
        users: {
          description: 'Custom annotated users table',
        },
      },
    });

    const updated = cache.applyAnnotations(newConfig);
    expect(updated.relations[0]?.description).toBe('Custom annotated users table');
    expect(cache.get().relations[0]?.description).toBe('Custom annotated users table');
    // Introspect was NOT called
    expect(introspectCalls).toBe(0);
  });

  it('cold cache initializes via refresh() and getAsync()', async () => {
    let introspectCalls = 0;
    const introspect = async () => {
      introspectCalls++;
      return createSyntheticIntrospection(1);
    };

    const cache = new SchemaCache({
      config: baseConfig,
      introspect,
    });

    // get() throws if cold
    expect(() => cache.get()).toThrow(/cold|no snapshot/);

    // getAsync() warms the cache
    const snapshot = await cache.getAsync();
    expect(snapshot.relations[0]?.name).toBe('users');
    expect(introspectCalls).toBe(1);

    // subsequent get() succeeds immediately
    expect(cache.get().relations[0]?.name).toBe('users');
    expect(introspectCalls).toBe(1);
  });
});
