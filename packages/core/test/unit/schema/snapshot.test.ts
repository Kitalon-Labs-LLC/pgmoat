import { describe, it, expect } from 'vitest';
import { buildSnapshot } from '../../../src/schema/snapshot.js';
import { checkAgainstSchema } from '../../../src/config/checks.js';
import { PgmoatConfig } from '../../../src/config/schema.js';
import type { IntrospectionResult, RawRelationInfo } from '../../../src/postgres/introspect.js';

function createSyntheticIntrospection(): IntrospectionResult {
  const users: RawRelationInfo = {
    oid: 1001,
    schema: 'public',
    name: 'users',
    kind: 'r',
    kindName: 'table',
    description: 'Postgres comment for users',
    rowEstimate: 100,
    relrowsecurity: true,
    relforcerowsecurity: false,
    owner: 'postgres',
    columns: [
      { name: 'id', type: 'uuid', notNull: true, default: 'gen_random_uuid()', ordinal: 1, description: 'User ID' },
      { name: 'tenant_id', type: 'uuid', notNull: true, default: null, ordinal: 2, description: null },
      { name: 'email', type: 'text', notNull: true, default: null, ordinal: 3, description: null },
      { name: 'password_hash', type: 'text', notNull: true, default: null, ordinal: 4, description: 'Secret password hash' },
      { name: 'mfa_secret', type: 'text', notNull: false, default: null, ordinal: 5, description: null },
    ],
    primaryKey: ['id'],
    uniqueKeys: [['email'], ['password_hash']],
    foreignKeys: [],
    indexes: [
      { name: 'users_pkey', columns: ['id'], unique: true, primary: true, definition: 'CREATE UNIQUE INDEX users_pkey ON users(id)' },
      { name: 'users_email_idx', columns: ['email'], unique: true, primary: false, definition: 'CREATE UNIQUE INDEX users_email_idx ON users(email)' },
      { name: 'users_pwd_idx', columns: ['password_hash'], unique: false, primary: false, definition: 'CREATE INDEX users_pwd_idx ON users(password_hash)' },
    ],
  };

  const orders: RawRelationInfo = {
    oid: 1002,
    schema: 'public',
    name: 'orders',
    kind: 'r',
    kindName: 'table',
    description: null, // No postgres comment
    rowEstimate: 500,
    relrowsecurity: false,
    relforcerowsecurity: false,
    owner: 'postgres',
    columns: [
      { name: 'id', type: 'uuid', notNull: true, default: 'gen_random_uuid()', ordinal: 1, description: null },
      { name: 'user_id', type: 'uuid', notNull: true, default: null, ordinal: 2, description: null },
      { name: 'amount', type: 'numeric(10,2)', notNull: true, default: null, ordinal: 3, description: null },
    ],
    primaryKey: ['id'],
    uniqueKeys: [],
    foreignKeys: [
      {
        name: 'orders_user_id_fkey',
        columns: ['user_id'],
        references: { schema: 'public', relation: 'users', columns: ['id'] },
        onDelete: 'CASCADE',
      },
      {
        name: 'orders_audit_fkey',
        columns: ['id'],
        references: { schema: 'public', relation: 'internal_audit', columns: ['target_id'] },
        onDelete: 'NO ACTION',
      },
    ],
    indexes: [],
  };

  const internalAudit: RawRelationInfo = {
    oid: 1003,
    schema: 'public',
    name: 'internal_audit',
    kind: 'r',
    kindName: 'table',
    description: 'Internal audit table',
    rowEstimate: 10,
    relrowsecurity: false,
    relforcerowsecurity: false,
    owner: 'postgres',
    columns: [
      { name: 'id', type: 'uuid', notNull: true, default: null, ordinal: 1, description: null },
      { name: 'target_id', type: 'uuid', notNull: true, default: null, ordinal: 2, description: null },
      { name: 'secret_payload', type: 'jsonb', notNull: false, default: null, ordinal: 3, description: null },
    ],
    primaryKey: ['id'],
    uniqueKeys: [['target_id']],
    foreignKeys: [],
    indexes: [],
  };

  return {
    serverVersionNum: 170000,
    currentUser: 'pgmoat_reader',
    relations: [users, orders, internalAudit],
  };
}

describe('buildSnapshot', () => {
  it('filters hidden relations and hidden columns everywhere with zero leaks', () => {
    const raw = createSyntheticIntrospection();
    const config = PgmoatConfig.parse({
      version: 1,
      server: { name: 'test-server' },
      connection: { url: 'postgresql://localhost/test' },
      tables: {
        users: {
          description: 'Custom YAML users table',
          sensitive_columns: ['email'],
          columns: {
            password_hash: { hidden: true },
            mfa_secret: { hidden: true },
          },
        },
        internal_audit: {
          hidden: true,
        },
      },
    });

    const snapshot = buildSnapshot(raw, config);

    // 1. Relations count and presence
    expect(snapshot.relations.length).toBe(2); // users and orders, internal_audit hidden
    expect(snapshot.hiddenCount).toBe(1);
    expect(snapshot.byQualifiedName.has('public.internal_audit')).toBe(false);
    expect(snapshot.byQualifiedName.has('public.users')).toBe(true);
    expect(snapshot.byQualifiedName.has('public.orders')).toBe(true);

    // 2. PolicyIndex includes hidden names
    expect(snapshot.policyIndex.hiddenRelations.has('public.internal_audit')).toBe(true);
    expect(snapshot.policyIndex.hiddenColumns.get('public.users')?.has('password_hash')).toBe(true);
    expect(snapshot.policyIndex.hiddenColumns.get('public.users')?.has('mfa_secret')).toBe(true);
    expect(snapshot.policyIndex.knownRelations.has('public.internal_audit')).toBe(true);

    // 3. Columns on users
    const usersRel = snapshot.byQualifiedName.get('public.users')!;
    expect(usersRel.columns.map((c) => c.name)).toEqual(['id', 'tenant_id', 'email']);
    expect(usersRel.hiddenColumnCount).toBe(2);

    // 4. Unique keys and indexes over hidden columns removed
    expect(usersRel.uniqueKeys).toEqual([['email']]); // ['password_hash'] removed
    expect(usersRel.indexes.map((i) => i.name)).toEqual(['users_pkey', 'users_email_idx']); // users_pwd_idx removed

    // 5. Foreign keys pointing to hidden relation removed
    const ordersRel = snapshot.byQualifiedName.get('public.orders')!;
    expect(ordersRel.foreignKeys.map((fk) => fk.name)).toEqual(['orders_user_id_fkey']); // orders_audit_fkey removed

    // 6. referencedBy on users
    expect(usersRel.referencedBy).toEqual([
      { relation: 'public.orders', columns: ['user_id'] },
    ]);

    // 7. CRITICAL: no hidden name leaks in JSON serialization
    const serialized = JSON.stringify(snapshot.relations);
    expect(serialized).not.toContain('internal_audit');
    expect(serialized).not.toContain('password_hash');
    expect(serialized).not.toContain('mfa_secret');
    expect(serialized).not.toContain('secret_payload');
    expect(serialized).not.toContain('users_pwd_idx');
  });

  it('respects description precedence: YAML > Postgres comment > Unannotated', () => {
    const raw = createSyntheticIntrospection();
    const config = PgmoatConfig.parse({
      version: 1,
      server: { name: 'test-server' },
      connection: { url: 'postgresql://localhost/test' },
      tables: {
        'public.users': {
          description: 'Explicit YAML description',
        },
        // orders has no YAML annotation, but has no Postgres comment
      },
    });

    const snapshot = buildSnapshot(raw, config);
    const users = snapshot.byQualifiedName.get('public.users')!;
    const orders = snapshot.byQualifiedName.get('public.orders')!;

    // users: YAML description wins over Postgres comment
    expect(users.description).toBe('Explicit YAML description');

    // orders: no YAML, no Postgres comment -> 'Unannotated'
    expect(orders.description).toBe('Unannotated');
  });

  it('sets sensitive: high from sensitive_columns shorthand', () => {
    const raw = createSyntheticIntrospection();
    const config = PgmoatConfig.parse({
      version: 1,
      server: { name: 'test-server' },
      connection: { url: 'postgresql://localhost/test' },
      tables: {
        users: {
          sensitive_columns: ['email'],
          columns: {
            tenant_id: { sensitive: 'low' },
          },
        },
      },
    });

    const snapshot = buildSnapshot(raw, config);
    const users = snapshot.byQualifiedName.get('public.users')!;

    const emailCol = users.columns.find((c) => c.name === 'email')!;
    const tenantCol = users.columns.find((c) => c.name === 'tenant_id')!;
    const idCol = users.columns.find((c) => c.name === 'id')!;

    expect(emailCol.sensitive).toBe('high');
    expect(tenantCol.sensitive).toBe('low');
    expect(idCol.sensitive).toBeNull();
  });
});

describe('checkAgainstSchema', () => {
  it('PGM-115: fails when annotate_strict is true and unannotated table exists', () => {
    const raw = createSyntheticIntrospection();
    const config = PgmoatConfig.parse({
      version: 1,
      server: { name: 'test-server' },
      connection: { url: 'postgresql://localhost/test' },
      schema: { annotate_strict: true },
      tables: {
        users: { description: 'Annotated users' },
        // orders is unannotated
      },
    });

    const snapshot = buildSnapshot(raw, config);
    const res = checkAgainstSchema(config, snapshot);

    expect(res.errors.some((e) => e.code === 'PGM-115')).toBe(true);
    expect(res.errors.find((e) => e.code === 'PGM-115')?.message).toContain('public.orders');
  });

  it('PGM-118: fails when a protected table is not found in database', () => {
    const raw = createSyntheticIntrospection();
    const config = PgmoatConfig.parse({
      version: 1,
      server: { name: 'test-server' },
      connection: { url: 'postgresql://localhost/test' },
      rls: {
        protected_tables: ['users', 'ghost_table'],
      },
    });

    const snapshot = buildSnapshot(raw, config);
    const res = checkAgainstSchema(config, snapshot);

    expect(res.errors.some((e) => e.code === 'PGM-118')).toBe(true);
    expect(res.errors.find((e) => e.code === 'PGM-118')?.message).toContain('ghost_table');
  });

  it('warns for STALE annotated tables and columns not in database', () => {
    const raw = createSyntheticIntrospection();
    const config = PgmoatConfig.parse({
      version: 1,
      server: { name: 'test-server' },
      connection: { url: 'postgresql://localhost/test' },
      tables: {
        users: {
          columns: {
            non_existent_column: { description: 'Old col' },
          },
        },
        non_existent_table: {
          description: 'Old table',
        },
      },
    });

    const snapshot = buildSnapshot(raw, config);
    const res = checkAgainstSchema(config, snapshot);

    expect(res.warnings.some((w) => w.message.includes('non_existent_table') && w.message.includes('STALE'))).toBe(true);
    expect(res.warnings.some((w) => w.message.includes('non_existent_column') && w.message.includes('STALE'))).toBe(true);
  });
});
