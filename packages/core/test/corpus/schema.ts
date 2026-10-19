import * as z from 'zod';

export const CorpusGroupSchema = z.enum([
  'allowed',
  'statements',
  'stacking',
  'cte',
  'functions',
  'sql-exec',
  'locking',
  'explain',
  'policy',
  'budgets',
  'edge',
]);

export type CorpusGroup = z.infer<typeof CorpusGroupSchema>;

export const CorpusExpectSchema = z.union([
  z.object({
    allowed: z.literal(true),
    refused: z.undefined().optional(),
  }),
  z.object({
    allowed: z.undefined().optional(),
    refused: z.string().regex(/^PGM-\d{3}$/),
  }),
]);

export const CorpusCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  group: CorpusGroupSchema,
  sql: z.string(),
  config: z.string().optional(),
  expect: CorpusExpectSchema,
  executes: z.boolean().optional(),
  db_blocks: z.boolean().optional(),
  note: z.string().optional(),
  bypass_class: z.string().optional(),
});

export type CorpusCase = z.infer<typeof CorpusCaseSchema>;

export const CorpusFileSchema = z.array(CorpusCaseSchema);
