import { describe, it, expect } from 'vitest';
import {
  RowsResultSchema,
  ListTablesResultSchema,
  DescribeTableResultSchema,
  ExplainResultSchema,
} from '../../../src/output/schemas.js';

describe('Output Schemas Validation', () => {
  it('validates a valid RowsResult', () => {
    const validRows = {
      columns: [
        { name: 'id', type: 'uuid', untrusted: false },
        { name: 'body', type: 'text', untrusted: true },
      ],
      rows: [{ id: 'a1b2', body: 'sample text' }],
      row_count: 1,
      truncated: false,
      warnings: [{ code: 'PGM-304', message: 'kept columns' }],
      request_id: '01JAB3W8K2Q9',
    };

    const parsed = RowsResultSchema.safeParse(validRows);
    expect(parsed.success).toBe(true);
  });

  it('rejects extra unrecognized keys in RowsResult (strict schema)', () => {
    const extraKey = {
      columns: [],
      rows: [],
      row_count: 0,
      truncated: false,
      warnings: [],
      request_id: '01JAB3W8K2Q9',
      unexpected_key: 'hacker',
    };

    const parsed = RowsResultSchema.safeParse(extraKey);
    expect(parsed.success).toBe(false);
  });

  it('validates a valid ListTablesResult', () => {
    const validList = {
      relations: [
        {
          schema: 'public',
          name: 'orders',
          qualified_name: 'public.orders',
          kind: 'table',
          description: 'One row per customer order.',
          row_estimate: 120034,
        },
        {
          schema: 'public',
          name: 'order_totals',
          qualified_name: 'public.order_totals',
          kind: 'view',
          description: 'Daily totals per tenant.',
          row_estimate: null,
        },
      ],
      hidden_count: 2,
      warnings: [],
      request_id: '01JAB3W8K2Q9',
    };

    const parsed = ListTablesResultSchema.safeParse(validList);
    expect(parsed.success).toBe(true);
  });

  it('validates a valid DescribeTableResult', () => {
    const validDesc = {
      table: {
        schema: 'public',
        name: 'users',
        qualified_name: 'public.users',
        kind: 'table',
        description: 'Application users.',
        row_estimate: 48000,
        columns: [
          {
            name: 'id',
            type: 'uuid',
            not_null: true,
            default: null,
            description: 'UUID primary key.',
            sensitive: null,
            untrusted: false,
          },
          {
            name: 'email',
            type: 'text',
            not_null: true,
            default: null,
            description: 'Lowercased on insert.',
            sensitive: 'medium',
            untrusted: false,
          },
        ],
        hidden_column_count: 2,
        primary_key: ['id'],
        unique_keys: [['email']],
        foreign_keys: [],
        referenced_by: [{ relation: 'public.orders', columns: ['user_id'] }],
        indexes: [
          {
            name: 'users_pkey',
            columns: ['id'],
            unique: true,
            primary: true,
            definition: 'CREATE UNIQUE INDEX...',
          },
        ],
        relationships: ['Has many orders via orders.user_id.'],
        rls: { enabled: true, forced: true },
      },
      warnings: [],
      request_id: '01JAB3W8K2Q9',
    };

    const parsed = DescribeTableResultSchema.safeParse(validDesc);
    expect(parsed.success).toBe(true);
  });

  it('validates a valid ExplainResult', () => {
    const validExplain = {
      plan: [{ Plan: { 'Node Type': 'Seq Scan', 'Total Cost': 12.5, 'Plan Rows': 100 } }],
      plan_summary: {
        top_node_type: 'Seq Scan',
        total_cost: 12.5,
        plan_rows: 100,
      },
      duration_ms: 12.4,
      warnings: [],
      request_id: '01JAB3W8K2Q9',
    };

    const parsed = ExplainResultSchema.safeParse(validExplain);
    expect(parsed.success).toBe(true);
  });
});
