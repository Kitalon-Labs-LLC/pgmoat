import * as z from 'zod';

export const WarningItemSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const ColumnSchema = z.object({
  name: z.string(),
  type: z.string(),
  untrusted: z.boolean(),
  masked: z.boolean().optional(),
});

export const RowsResultSchema = z
  .object({
    columns: z.array(ColumnSchema),
    rows: z.array(z.record(z.string(), z.any())),
    row_count: z.number().int().min(0),
    truncated: z.boolean(),
    warnings: z.array(WarningItemSchema),
    request_id: z.string(),
  })
  .strict();

export type RowsResultT = z.infer<typeof RowsResultSchema>;

export const TableSummarySchema = z.object({
  schema: z.string(),
  name: z.string(),
  qualified_name: z.string(),
  kind: z.enum([
    'table',
    'partitioned_table',
    'view',
    'materialized_view',
    'foreign_table',
  ]),
  description: z.string(),
  row_estimate: z.number().nullable(),
});

export const ListTablesResultSchema = z
  .object({
    relations: z.array(TableSummarySchema),
    hidden_count: z.number().int().min(0),
    warnings: z.array(WarningItemSchema),
    request_id: z.string(),
  })
  .strict();

export type ListTablesResultT = z.infer<typeof ListTablesResultSchema>;

export const DescribeColumnSchema = z.object({
  name: z.string(),
  type: z.string(),
  not_null: z.boolean(),
  default: z.string().nullable(),
  description: z.string(),
  sensitive: z.enum(['low', 'medium', 'high']).nullable(),
  untrusted: z.boolean(),
});

export const DescribeForeignKeySchema = z.object({
  name: z.string(),
  columns: z.array(z.string()),
  references: z.object({
    relation: z.string(),
    columns: z.array(z.string()),
  }),
  on_delete: z.string(),
});

export const DescribeIndexSchema = z.object({
  name: z.string(),
  columns: z.array(z.string()),
  unique: z.boolean(),
  primary: z.boolean(),
  definition: z.string(),
});

export const DescribeTableResultSchema = z
  .object({
    table: z.object({
      schema: z.string(),
      name: z.string(),
      qualified_name: z.string(),
      kind: z.enum([
        'table',
        'partitioned_table',
        'view',
        'materialized_view',
        'foreign_table',
      ]),
      description: z.string(),
      row_estimate: z.number().nullable(),
      columns: z.array(DescribeColumnSchema),
      hidden_column_count: z.number().int().min(0),
      primary_key: z.array(z.string()).nullable(),
      unique_keys: z.array(z.array(z.string())),
      foreign_keys: z.array(DescribeForeignKeySchema),
      referenced_by: z.array(
        z.object({
          relation: z.string(),
          columns: z.array(z.string()),
        }),
      ),
      indexes: z.array(DescribeIndexSchema),
      relationships: z.array(z.string()),
      rls: z.object({
        enabled: z.boolean(),
        forced: z.boolean().optional(),
      }),
    }),
    warnings: z.array(WarningItemSchema),
    request_id: z.string(),
  })
  .strict();

export type DescribeTableResultT = z.infer<typeof DescribeTableResultSchema>;

export const ExplainSummarySchema = z.object({
  top_node_type: z.string(),
  total_cost: z.number(),
  plan_rows: z.number(),
  plan_width: z.number().optional(),
});

export const ExplainResultSchema = z
  .object({
    plan: z.any(),
    plan_summary: ExplainSummarySchema,
    duration_ms: z.number(),
    warnings: z.array(WarningItemSchema),
    request_id: z.string(),
  })
  .strict();

export type ExplainResultT = z.infer<typeof ExplainResultSchema>;
