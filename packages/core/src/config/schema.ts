import * as z from 'zod';

const ms = (min: number) => z.number().int().min(min);

export const RlsSource = z
  .string()
  .regex(
    /^(token\.[A-Za-z0-9_.-]+|env\.[A-Z_][A-Z0-9_]*|static:.+|meta\.[A-Za-z0-9_-]+)$/,
    'RLS source must be token.<claim>, env.<VAR>, static:<value>, or meta.<key>',
  );

export const PgSetting = z
  .string()
  .regex(
    /^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_.]*$/,
    'custom setting names need a prefix and a dot, e.g. app.tenant_id',
  );

export const ColumnAnnotation = z
  .object({
    description: z.string().max(500).optional(),
    sensitive: z.enum(['low', 'medium', 'high']).optional(),
    hidden: z.boolean().default(false),
    untrusted: z.boolean().default(false),
  })
  .strict();

export const TableAnnotation = z
  .object({
    description: z.string().max(500).optional(),
    hidden: z.boolean().default(false),
    sensitive_columns: z.array(z.string()).default([]),
    columns: z.record(z.string(), ColumnAnnotation).default({}),
    relationships: z.array(z.string().max(200)).default([]),
    // v1.1 scoped-write
    write: z.array(z.enum(['insert', 'update', 'delete'])).default([]),
    update_columns: z.array(z.string()).default([]),
    insert_required_columns: z.array(z.string()).default([]),
    insert_defaults: z
      .record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean(), z.null()]),
      )
      .default({}),
    max_affected_rows: z.number().int().min(1).max(10_000).default(100),
  })
  .strict();

const AuditCommon = {
  redact_fields: z
    .array(z.string())
    .default([
      'password',
      'passwd',
      'secret',
      'token',
      'api_key',
      'apikey',
      'ssn',
      'fein',
      'card_number',
      'credit_card',
      'cvv',
      'iban',
    ]),
  redact_in_sql: z.boolean().default(true),
  redact_patterns: z.array(z.string()).default(['\\b\\d{3}-\\d{2}-\\d{4}\\b']),
  buffer_max_bytes: z.number().int().min(65_536).default(10_485_760),
  flush_interval_ms: ms(10).default(100),
};

export const AuditConfig = z.discriminatedUnion('destination', [
  z.object({ destination: z.literal('stderr'), ...AuditCommon }).strict(),
  z.object({ destination: z.literal('stdout'), ...AuditCommon }).strict(),
  z
    .object({
      destination: z.literal('file'),
      ...AuditCommon,
      path: z.string().optional(), // default: per-OS state dir
      rotation: z
        .union([z.literal('daily'), z.string().regex(/^size:\d+(KB|MB|GB)$/)])
        .default('daily'),
      retain_days: z.number().int().min(1).default(90),
    })
    .strict(),
  z
    .object({
      destination: z.literal('postgres'),
      ...AuditCommon,
      postgres: z
        .object({
          url: z.string().min(1),
          schema: z.string().default('pgmoat'),
          table: z.string().default('audit'),
          pool_max: z.number().int().min(1).max(20).default(3),
          tenant_key: z.string().default('app.tenant_id'),
          create_schema: z.boolean().default(true),
        })
        .strict(),
    })
    .strict(),
]);

export const PgmoatConfig = z
  .object({
    version: z.literal(1),
    server: z
      .object({
        name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
        description: z.string().max(280).default(''),
      })
      .strict(),

    transport: z.enum(['stdio', 'http']).default('stdio'),
    http: z
      .object({
        host: z.string().default('127.0.0.1'),
        port: z.number().int().min(1).max(65535).default(8787),
        path: z.string().startsWith('/').default('/mcp'),
        public_url: z.string().url().optional(), // canonical URL; required when auth is set
        allowed_hosts: z.array(z.string()).default([]),
        allowed_origins: z.array(z.string()).default([]),
        max_body_bytes: z.number().int().min(1024).default(1_048_576),
      })
      .strict()
      .prefault({}),

    auth: z
      .object({
        mode: z.enum(['oauth', 'none']).default('oauth'),
        issuer: z.string().url().optional(),
        audience: z.string().optional(),
        jwks_url: z.string().url().optional(),
        algorithms: z.array(z.string()).default(['RS256', 'ES256', 'EdDSA']),
        required_scopes: z.array(z.string()).default(['pgmoat:read']),
        clock_tolerance_s: z.number().int().min(0).max(300).default(30),
      })
      .strict()
      .optional(),

    connection: z
      .object({
        url: z.string().min(1),
        schemas: z.array(z.string()).min(1).default(['public']),
        application_name: z.string().default('pgmoat'),
        pool: z
          .object({
            min: z.number().int().min(0).default(1),
            max: z.number().int().min(1).max(100).default(10),
            acquire_timeout_ms: ms(100).default(3000),
          })
          .strict()
          .prefault({}),
        ssl: z.enum(['disable', 'prefer', 'require', 'verify-full']).optional(), // overrides URL sslmode if set
      })
      .strict(),

    mode: z.enum(['read-only', 'scoped-write']).default('read-only'),

    budgets: z
      .object({
        max_rows: z.number().int().min(1).max(10_000).default(200),
        max_query_ms: ms(100).default(5000),
        max_explain_ms: ms(50).default(500),
        lock_timeout_ms: ms(10).default(1000),
        max_columns: z.number().int().min(1).max(1000).default(50),
        max_payload_bytes: z
          .number()
          .int()
          .min(1024)
          .max(16_777_216)
          .default(65_536),
        max_cell_chars: z.number().int().min(20).default(500),
        max_sql_chars: z.number().int().min(100).default(65_536),
        offset_warning: z.number().int().min(0).default(10_000),
      })
      .strict()
      .prefault({}),

    rls: z
      .object({
        required: z.boolean().default(false),
        trust_request_meta: z.boolean().default(false),
        protected_tables: z.array(z.string()).default([]),
        session_variables: z.record(PgSetting, RlsSource).default({}),
      })
      .strict()
      .prefault({}),

    policy: z
      .object({
        allow_catalog_queries: z.boolean().default(false),
        allowed_functions: z.array(z.string()).default([]), // schema-qualified names, e.g. 'public.business_days'
        strict_unqualified_columns: z.boolean().default(true),
      })
      .strict()
      .prefault({}),

    schema: z
      .object({
        cache_ttl_s: z.number().int().min(5).default(60),
        annotate_strict: z.boolean().default(false),
      })
      .strict()
      .prefault({}),

    tables: z.record(z.string(), TableAnnotation).default({}),

    write: z
      .object({
        // v1.1
        confirm: z.enum(['always', 'never']).default('always'),
      })
      .strict()
      .prefault({}),

    audit: AuditConfig.prefault({ destination: 'file' }),

    doctor: z
      .object({
        on_start: z.enum(['enforce', 'warn', 'off']).default('enforce'),
      })
      .strict()
      .prefault({}),

    logging: z
      .object({
        level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
        format: z.enum(['ndjson', 'pretty']).default('ndjson'),
      })
      .strict()
      .prefault({}),

    telemetry: z
      .object({
        enabled: z.boolean().default(false),
        endpoint: z
          .string()
          .url()
          .default('https://telemetry.pgmoat.dev/v1/events'),
      })
      .strict()
      .prefault({}),
  })
  .strict();

export type PgmoatConfigT = z.infer<typeof PgmoatConfig>;
export type PgmoatConfigInput = z.input<typeof PgmoatConfig>;
export type ColumnAnnotationT = z.infer<typeof ColumnAnnotation>;
export type TableAnnotationT = z.infer<typeof TableAnnotation>;
export type AuditConfigT = z.infer<typeof AuditConfig>;
