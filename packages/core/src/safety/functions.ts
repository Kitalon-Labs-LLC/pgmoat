import type { ErrorCode } from '../errors.generated.js';
import type { Scope } from './walk.js';
import { unwrap } from './walk.js';
import type { PgmoatConfigT } from '../config/schema.js';

export const ALLOWED_FUNCTIONS: ReadonlySet<string> = Object.freeze(
  new Set([
    // Aggregates and window
    'count',
    'sum',
    'avg',
    'min',
    'max',
    'array_agg',
    'string_agg',
    'json_agg',
    'jsonb_agg',
    'json_object_agg',
    'jsonb_object_agg',
    'bool_and',
    'bool_or',
    'every',
    'bit_and',
    'bit_or',
    'stddev',
    'stddev_pop',
    'stddev_samp',
    'variance',
    'var_pop',
    'var_samp',
    'corr',
    'covar_pop',
    'covar_samp',
    'regr_avgx',
    'regr_avgy',
    'regr_count',
    'regr_intercept',
    'regr_r2',
    'regr_slope',
    'regr_sxx',
    'regr_sxy',
    'regr_syy',
    'percentile_cont',
    'percentile_disc',
    'mode',
    'row_number',
    'rank',
    'dense_rank',
    'percent_rank',
    'cume_dist',
    'ntile',
    'lag',
    'lead',
    'first_value',
    'last_value',
    'nth_value',

    // Math
    'abs',
    'ceil',
    'ceiling',
    'floor',
    'round',
    'trunc',
    'mod',
    'power',
    'sqrt',
    'cbrt',
    'exp',
    'ln',
    'log',
    'log10',
    'sign',
    'pi',
    'random',
    'greatest',
    'least',
    'width_bucket',
    'div',
    'gcd',
    'lcm',
    'acos',
    'acosd',
    'asin',
    'asind',
    'atan',
    'atand',
    'atan2',
    'atan2d',
    'cos',
    'cosd',
    'cot',
    'cotd',
    'sin',
    'sind',
    'tan',
    'tand',
    'sinh',
    'cosh',
    'tanh',
    'asinh',
    'acosh',
    'atanh',
    'degrees',
    'radians',

    // String
    'length',
    'char_length',
    'octet_length',
    'lower',
    'upper',
    'initcap',
    'trim',
    'btrim',
    'ltrim',
    'rtrim',
    'lpad',
    'rpad',
    'substr',
    'substring',
    'left',
    'right',
    'position',
    'strpos',
    'replace',
    'translate',
    'concat',
    'concat_ws',
    'split_part',
    'string_to_array',
    'array_to_string',
    'regexp_match',
    'regexp_matches',
    'regexp_replace',
    'regexp_split_to_array',
    'regexp_split_to_table',
    'regexp_count',
    'regexp_like',
    'starts_with',
    'reverse',
    'repeat',
    'md5',
    'encode',
    'decode',
    'format',
    'quote_ident',
    'quote_literal',
    'to_hex',
    'ascii',
    'chr',
    'unaccent',

    // Date and time
    'now',
    'current_date',
    'current_time',
    'current_timestamp',
    'localtime',
    'localtimestamp',
    'clock_timestamp',
    'statement_timestamp',
    'transaction_timestamp',
    'date_trunc',
    'date_part',
    'extract',
    'date_bin',
    'age',
    'make_date',
    'make_time',
    'make_timestamp',
    'make_timestamptz',
    'make_interval',
    'to_char',
    'to_date',
    'to_timestamp',
    'to_number',
    'justify_days',
    'justify_hours',
    'justify_interval',
    'isfinite',
    'timezone',

    // JSON
    'to_json',
    'to_jsonb',
    'json_build_object',
    'jsonb_build_object',
    'json_build_array',
    'jsonb_build_array',
    'json_array_elements',
    'jsonb_array_elements',
    'json_array_elements_text',
    'jsonb_array_elements_text',
    'json_each',
    'jsonb_each',
    'json_each_text',
    'jsonb_each_text',
    'json_object_keys',
    'jsonb_object_keys',
    'json_extract_path',
    'jsonb_extract_path',
    'json_extract_path_text',
    'jsonb_extract_path_text',
    'jsonb_path_query',
    'jsonb_path_query_array',
    'jsonb_path_query_first',
    'jsonb_path_exists',
    'jsonb_path_match',
    'json_typeof',
    'jsonb_typeof',
    'jsonb_strip_nulls',
    'jsonb_pretty',
    'jsonb_array_length',
    'json_array_length',
    'jsonb_set',

    // Arrays and sets
    'array_length',
    'array_position',
    'array_positions',
    'array_remove',
    'array_replace',
    'array_append',
    'array_prepend',
    'array_cat',
    'cardinality',
    'unnest',
    'generate_series',
    'generate_subscripts',
    'array_dims',
    'array_lower',
    'array_upper',

    // Conditional and type
    'coalesce',
    'nullif',
    'pg_typeof',
    'num_nonnulls',
    'num_nulls',

    // UUID
    'gen_random_uuid',
    'uuidv4',
    'uuidv7',
    'uuid_extract_timestamp',
    'uuid_extract_version',

    // Full text
    'to_tsvector',
    'to_tsquery',
    'plainto_tsquery',
    'phraseto_tsquery',
    'websearch_to_tsquery',
    'ts_rank',
    'ts_rank_cd',
    'ts_headline',
    'setweight',
    'strip',
    'numnode',
    'querytree',

    // pgvector
    'l2_distance',
    'cosine_distance',
    'inner_product',
    'l1_distance',
    'vector_dims',
    'vector_norm',
    'l2_normalize',
    'subvector',

    // Settings
    'current_setting',
    'current_user',
    'session_user',
    'current_schema',
    'version',
  ]),
);

export const NEVER_ALLOWED_FUNCTIONS: ReadonlySet<string> = Object.freeze(
  new Set([
    // SQL-executing
    'query_to_xml',
    'query_to_xmlschema',
    'query_to_xml_and_xmlschema',
    'cursor_to_xml',
    'cursor_to_xmlschema',
    'table_to_xml',
    'table_to_xmlschema',
    'table_to_xml_and_xmlschema',
    'schema_to_xml',
    'schema_to_xmlschema',
    'schema_to_xml_and_xmlschema',
    'database_to_xml',
    'database_to_xmlschema',
    'database_to_xml_and_xmlschema',
    'ts_stat',
    'dblink',
    'dblink_exec',
    'dblink_open',
    'dblink_fetch',
    'dblink_send_query',
    'dblink_get_result',

    // State-changing
    'set_config',
    'nextval',
    'setval',
    'pg_advisory_lock',
    'pg_advisory_lock_shared',
    'pg_advisory_unlock',
    'pg_advisory_unlock_all',
    'pg_advisory_unlock_shared',
    'pg_advisory_xact_lock',
    'pg_advisory_xact_lock_shared',
    'pg_try_advisory_lock',
    'pg_try_advisory_lock_shared',
    'pg_try_advisory_xact_lock',
    'pg_try_advisory_xact_lock_shared',
    'pg_notify',
    'txid_current',
    'pg_current_xact_id',
    'lo_create',
    'lo_open',
    'lo_close',
    'lo_read',
    'lo_write',
    'lo_lseek',
    'lo_lseek64',
    'lo_tell',
    'lo_tell64',
    'lo_truncate',
    'lo_truncate64',
    'lo_unlink',
    'lo_import',
    'lo_export',
    'pg_logical_emit_message',
    'pg_logical_slot_get_changes',
    'pg_logical_slot_peek_changes',
    'pg_logical_slot_get_binary_changes',
    'pg_logical_slot_peek_binary_changes',
    'pg_create_logical_replication_slot',
    'pg_drop_replication_slot',
    'pg_replication_slot_advance',

    // Process and server control
    'pg_sleep',
    'pg_sleep_for',
    'pg_sleep_until',
    'pg_terminate_backend',
    'pg_cancel_backend',
    'pg_reload_conf',
    'pg_rotate_logfile',
    'pg_switch_wal',
    'pg_promote',
    'pg_backup_start',
    'pg_backup_stop',

    // File system
    'pg_read_file',
    'pg_read_binary_file',
    'pg_ls_dir',
    'pg_ls_logdir',
    'pg_ls_waldir',
    'pg_ls_tmpdir',
    'pg_ls_archive_statusdir',
    'pg_stat_file',
    'pg_file_write',
    'pg_file_rename',
    'pg_file_unlink',
  ]),
);

export function isNeverAllowed(name: string): boolean {
  const lower = name.toLowerCase();
  if (NEVER_ALLOWED_FUNCTIONS.has(lower)) {
    return true;
  }
  return (
    lower.startsWith('dblink_') ||
    lower.startsWith('pg_advisory_') ||
    lower.startsWith('pg_try_advisory_') ||
    lower.startsWith('lo_') ||
    lower.startsWith('pg_logical_') ||
    lower.startsWith('pg_replication_') ||
    lower.startsWith('pg_create_') ||
    lower.startsWith('pg_drop_') ||
    lower.startsWith('pg_sleep') ||
    lower.startsWith('pg_backup_') ||
    lower.startsWith('pg_read_') ||
    lower.startsWith('pg_file_') ||
    lower.startsWith('pg_ls_')
  );
}

export type FunctionCheckHook = (
  funcNode: unknown,
  path: readonly (string | number)[],
  scope: Scope,
) => { ok: false; code: ErrorCode; message: string; node?: unknown } | null;

export function functionPolicy(
  config?: PgmoatConfigT | Partial<PgmoatConfigT>,
): FunctionCheckHook {
  const allowedUserFunctions = new Set(config?.policy?.allowed_functions ?? []);

  return (funcNode) => {
    const inner = unwrap(funcNode) as Record<string, unknown>;
    const funcnameList = inner.funcname as unknown[];
    if (!Array.isArray(funcnameList) || funcnameList.length === 0) {
      return null;
    }

    const parts = funcnameList.map((part) => {
      const unwrapped = unwrap(part) as { sval?: string } | null;
      return typeof unwrapped?.sval === 'string' ? unwrapped.sval : '';
    });

    let schema: string | null = null;
    let name = '';

    if (parts.length === 1) {
      name = parts[0] ?? '';
    } else if (parts.length >= 2) {
      schema = parts[0] ?? null;
      name = parts[parts.length - 1] ?? '';
    }

    // 1. Never-allowed (by name, any schema) first
    if (isNeverAllowed(name)) {
      return {
        ok: false,
        code: 'PGM-205',
        message: `Function "${name}" is not allowed. See https://kitalonlabs.com/pgmoat/docs/safety#functions`,
        node: funcNode,
      };
    }

    // 2. Qualified and schema is not pg_catalog: require exact schema.name in policy.allowed_functions
    if (schema !== null && schema.toLowerCase() !== 'pg_catalog') {
      const qualified = `${schema}.${name}`;
      if (!allowedUserFunctions.has(qualified)) {
        return {
          ok: false,
          code: 'PGM-205',
          message: `Function "${qualified}" is not allowed. See https://kitalonlabs.com/pgmoat/docs/safety#functions`,
          node: funcNode,
        };
      }
      return null;
    }

    // 3. Unqualified or pg_catalog: require name in ALLOWED_FUNCTIONS
    // Notice: exact case match against ALLOWED_FUNCTIONS (which contains lowercase names)
    // Unquoted functions are folded to lowercase by Postgres, quoted mixed-case are preserved and refused
    if (!ALLOWED_FUNCTIONS.has(name)) {
      const display = schema ? `${schema}.${name}` : name;
      return {
        ok: false,
        code: 'PGM-205',
        message: `Function "${display}" is not allowed. See https://kitalonlabs.com/pgmoat/docs/safety#functions`,
        node: funcNode,
      };
    }

    return null;
  };
}
