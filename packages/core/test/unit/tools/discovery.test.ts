import { describe, it, expect } from 'vitest';
import { executeListTables, listTablesTool } from '../../../src/tools/list-tables.js';
import { executeDescribeTable, describeTableTool } from '../../../src/tools/describe-table.js';
import { buildSnapshot } from '../../../src/schema/snapshot.js';
import { PgmoatConfig } from '../../../src/config/schema.js';
import { ListTablesResultSchema, DescribeTableResultSchema } from '../../../src/output/schemas.js';
import { PgmoatError } from '../../../src/errors.js';
import type { SchemaCache } from '../../../src/schema/cache.js';
import type { IntrospectionResult, RawRelationInfo } from '../../../src/postgres/introspect.js';
import type { ToolDeps } from '../../../src/tools/context.js';
import type { AuditEntry } from '../../../src/types.js';

function createSyntheticIntrospection(): IntrospectionResult {
  const users: RawRelationInfo = {
    oid: 1001,
    schema: 'public',
    name: 'users',
    kind: 'r',
    kindName: 'table',
    description: 'Application users. One row per registered account.',
    rowEstimate: 48000,
    relrowsecurity: true,
    relforcerowsecurity: false,
    owner: 'postgres',
    columns: [
      { name: 'id', type: 'uuid', notNull: true, default: 'gen_random_uuid()', ordinal: 1, description: 'UUID primary key.' },
      { name: 'email', type: 'text', notNull: true, default: null, ordinal: 2, description: 'User email address' },
      { name: 'password_hash', type: 'text', notNull: true, default: null, ordinal: 3, description: 'Secret password hash' },
      { name: 'mfa_secret', type: 'text', notNull: false, default: null, ordinal: 4, description: 'MFA secret seed' },
    ],
    primaryKey: ['id'],
    uniqueKeys: [['email']],
    foreignKeys: [],
    indexes: [
      { name: 'users_pkey', columns: ['id'], unique: true, primary: true, definition: 'CREATE UNIQUE INDEX users_pkey ON users(id)' },
      { name: 'users_email_key', columns: ['email'], unique: true, primary: false, definition: 'CREATE UNIQUE INDEX users_email_key ON users(email)' },
    ],
  };

  const orders: RawRelationInfo = {
    oid: 1002,
    schema: 'public',
    name: 'orders',
    kind: 'r',
    kindName: 'table',
    description: 'One row per customer order.',
    rowEstimate: 120034,
    relrowsecurity: false,
    relforcerowsecurity: false,
    owner: 'postgres',
    columns: [
      { name: 'id', type: 'uuid', notNull: true, default: 'gen_random_uuid()', ordinal: 1, description: 'Order ID' },
      { name: 'user_id', type: 'uuid', notNull: true, default: null, ordinal: 2, description: 'Customer reference' },
      { name: 'amount', type: 'numeric(10,2)', notNull: true, default: null, ordinal: 3, description: 'Total charge' },
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
    ],
    indexes: [
      { name: 'orders_pkey', columns: ['id'], unique: true, primary: true, definition: 'CREATE UNIQUE INDEX orders_pkey ON orders(id)' },
    ],
  };

  const orderTotals: RawRelationInfo = {
    oid: 1003,
    schema: 'public',
    name: 'order_totals',
    kind: 'v',
    kindName: 'view',
    description: 'Daily totals per tenant.',
    rowEstimate: -1, // view has no stats
    relrowsecurity: false,
    relforcerowsecurity: false,
    owner: 'postgres',
    columns: [
      { name: 'day', type: 'date', notNull: false, default: null, ordinal: 1, description: 'Aggregation date' },
      { name: 'total', type: 'numeric', notNull: false, default: null, ordinal: 2, description: 'Sum of orders' },
    ],
    primaryKey: null,
    uniqueKeys: [],
    foreignKeys: [],
    indexes: [],
  };

  const internalAudit: RawRelationInfo = {
    oid: 1004,
    schema: 'public',
    name: 'internal_audit',
    kind: 'r',
    kindName: 'table',
    description: 'System internal audit trail',
    rowEstimate: 50000,
    relrowsecurity: false,
    relforcerowsecurity: false,
    owner: 'postgres',
    columns: [
      { name: 'id', type: 'uuid', notNull: true, default: null, ordinal: 1, description: null },
      { name: 'action', type: 'text', notNull: true, default: null, ordinal: 2, description: null },
    ],
    primaryKey: ['id'],
    uniqueKeys: [],
    foreignKeys: [],
    indexes: [],
  };

  return {
    serverVersionNum: 170000,
    currentUser: 'pgmoat_reader',
    relations: [users, orders, orderTotals, internalAudit],
  };
}

describe('Discovery tools: list_tables and describe_table', () => {
  const config = PgmoatConfig.parse({
    version: 1,
    server: { name: 'test-pgmoat' },
    connection: { url: 'postgresql://localhost/test', schemas: ['public'] },
    tables: {
      users: {
        sensitive_columns: ['email'],
        columns: {
          password_hash: { hidden: true },
          mfa_secret: { hidden: true },
        },
        relationships: ['Has many orders via orders.user_id.'],
      },
      internal_audit: {
        hidden: true,
      },
    },
  });

  const snapshot = buildSnapshot(createSyntheticIntrospection(), config);

  it('list_tables: sorts relations, formats view kinds, excludes hidden relations, reports hidden count', () => {
    const outcome = executeListTables({}, snapshot, '01JATESTREQ0001');

    // Schema validation
    const parsed = ListTablesResultSchema.parse(outcome.structured);
    expect(parsed.request_id).toBe('01JATESTREQ0001');

    // Alphabetical order: public.order_totals, public.orders, public.users
    expect(parsed.relations.map((r) => r.qualified_name)).toEqual([
      'public.order_totals',
      'public.orders',
      'public.users',
    ]);

    // View kind and row_estimate null
    const view = parsed.relations.find((r) => r.name === 'order_totals');
    expect(view?.kind).toBe('view');
    expect(view?.row_estimate).toBeNull();

    // Table kind and row estimate
    const ordersTbl = parsed.relations.find((r) => r.name === 'orders');
    expect(ordersTbl?.kind).toBe('table');
    expect(ordersTbl?.row_estimate).toBe(120034);

    // Hidden table is strictly excluded
    expect(parsed.relations.some((r) => r.name === 'internal_audit')).toBe(false);
    expect(parsed.hidden_count).toBe(1);

    // Rendered text specimen assertion
    expect(outcome.text).toContain('- public.order_totals (view): Daily totals per tenant.');
    expect(outcome.text).toContain('- public.orders (table, ~120k rows): One row per customer order.');
    expect(outcome.text).toContain('- public.users (table, ~48k rows): Application users.');
    expect(outcome.text).toContain('1 relation hidden by configuration.');
  });

  it('list_tables: filters by schema when requested', () => {
    const outcome = executeListTables({ schema: 'public' }, snapshot, '01JATESTREQ0002');
    const parsed = ListTablesResultSchema.parse(outcome.structured);
    expect(parsed.relations.length).toBe(3);

    // Unexposed schema throws PGM-207
    expect(() => executeListTables({ schema: 'secret_schema' }, snapshot, '01JATESTREQ0003')).toThrow(
      PgmoatError,
    );
  });

  it('describe_table: resolves qualified and unqualified names, reports fields, hides hidden columns', () => {
    // Unqualified name 'users'
    const outcome = executeDescribeTable({ table: 'users' }, snapshot, '01JATESTREQ0004');

    // Schema validation
    const parsed = DescribeTableResultSchema.parse(outcome.structured);
    const tbl = parsed.table;

    expect(tbl.qualified_name).toBe('public.users');
    expect(tbl.row_estimate).toBe(48000);
    expect(tbl.description).toContain('Application users');

    // Visible columns only
    expect(tbl.columns.map((c) => c.name)).toEqual(['id', 'email']);
    expect(tbl.hidden_column_count).toBe(2);

    // Column sensitivity
    const emailCol = tbl.columns.find((c) => c.name === 'email');
    expect(emailCol?.sensitive).toBe('high');

    // Referenced by
    expect(tbl.referenced_by).toEqual([
      { relation: 'public.orders', columns: ['user_id'] },
    ]);

    // Primary key & indexes
    expect(tbl.primary_key).toEqual(['id']);
    expect(tbl.indexes.length).toBe(2);
    expect(tbl.relationships).toEqual(['Has many orders via orders.user_id.']);
    expect(tbl.rls.enabled).toBe(true);

    // Rendered text specimen
    expect(outcome.text).toContain('Table public.users (~48k rows): Application users.');
    expect(outcome.text).toContain('2 columns hidden by configuration.');
    expect(outcome.text).toContain('Referenced by: public.orders(user_id)');
    expect(outcome.text).toContain('Relationships: Has many orders via orders.user_id.');
  });

  it('describe_table: hidden table refusal is identical to unknown table refusal (PGM-207)', () => {
    let unknownErr: PgmoatError | null = null;
    let hiddenErr: PgmoatError | null = null;

    try {
      executeDescribeTable({ table: 'nonexistent_table' }, snapshot, '01JATESTREQ0005');
    } catch (err) {
      if (err instanceof PgmoatError) unknownErr = err;
    }

    try {
      executeDescribeTable({ table: 'internal_audit' }, snapshot, '01JATESTREQ0006');
    } catch (err) {
      if (err instanceof PgmoatError) hiddenErr = err;
    }

    expect(unknownErr).not.toBeNull();
    expect(hiddenErr).not.toBeNull();

    expect(unknownErr?.code).toBe('PGM-207');
    expect(hiddenErr?.code).toBe('PGM-207');
    expect(unknownErr?.message).toBe(hiddenErr?.message);
    expect(unknownErr?.message).toBe(
      'Table not available. Use list_tables to see the tables you can query.',
    );
  });

  it('runs through tool wrappers with RequestContext and audit emission', async () => {
    const emitted: AuditEntry[] = [];
    const deps: ToolDeps = {
      config,
      instanceId: 'inst-discovery-01',
      schemaCache: {
        get: () => snapshot,
      } as unknown as SchemaCache,
      audit: {
        emit: (entry) => {
          emitted.push(entry);
        },
      },
    };

    const listRes = await listTablesTool({}, {}, deps);
    expect(listRes._meta['com.kitalonlabs.pgmoat/request_id']).toBeDefined();
    expect(emitted.length).toBe(1);
    expect(emitted[0]?.tool).toBe('list_tables');
    expect(emitted[0]?.status).toBe('success');

    const descRes = await describeTableTool({ table: 'orders' }, {}, deps);
    expect(descRes._meta['com.kitalonlabs.pgmoat/request_id']).toBeDefined();
    expect(emitted.length).toBe(2);
    expect(emitted[1]?.tool).toBe('describe_table');
    expect(emitted[1]?.status).toBe('success');
  });
});
