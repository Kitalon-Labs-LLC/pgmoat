import pg from 'pg';

export interface TypeParserOverrides {
  getTypeParser(oid: number, format?: string): (value: string) => unknown;
}

/**
 * Formats bytea size as a human-readable metadata placeholder.
 */
export function formatBytea(val: number | Buffer | string): string {
  if (typeof val === 'number') {
    return `<bytea ${val} bytes>`;
  }
  if (Buffer.isBuffer(val)) {
    return `<bytea ${val.length} bytes>`;
  }
  if (typeof val === 'string') {
    if (val.startsWith('<bytea ') && val.endsWith(' bytes>')) {
      return val;
    }
    if (val.startsWith('\\x')) {
      const bytes = Math.max(0, Math.floor((val.length - 2) / 2));
      return `<bytea ${bytes} bytes>`;
    }
    return `<bytea ${Buffer.byteLength(val, 'utf-8')} bytes>`;
  }
  return '<bytea 0 bytes>';
}

/**
 * Escapes strings for embedding in Markdown table cells:
 * 1. Pipe characters '|' -> '\|'
 * 2. Newline characters '\r\n', '\n', '\r' -> '\n'
 * 3. Fence delimiter strings '<<<pgmoat:' -> '<<<pgmoat\:'
 */
export function escapeMarkdownCell(text: string): string {
  return text
    .replace(/\|/g, '\\|')
    .replace(/\r\n|\n|\r/g, '\\n')
    .replace(/<<<pgmoat:/g, '<<<pgmoat\\:');
}

/**
 * Creates custom PostgreSQL type parser overrides for a pg.Pool or pg.Client.
 * Ensures int8/numeric are parsed as strings, timestamps as ISO strings,
 * date as YYYY-MM-DD, json/jsonb parsed, bytea as metadata summary,
 * arrays recursively, and unknown types as their text form.
 *
 * Does NOT pollute global pg.types.
 */
export function createPgTypeParserOverrides(): TypeParserOverrides {
  // Builtin OIDs
  const OID_BYTEA = 17;
  const OID_INT8 = 20;
  const OID_JSON = 114;
  const OID_DATE = 1082;
  const OID_TIMESTAMP = 1114;
  const OID_TIMESTAMPTZ = 1184;
  const OID_NUMERIC = 1700;
  const OID_JSONB = 3802;

  // Array OIDs
  const OID_ARRAY_BYTEA = 1001;
  const OID_ARRAY_INT8 = 1016;
  const OID_ARRAY_DATE = 1182;
  const OID_ARRAY_TIMESTAMP = 1115;
  const OID_ARRAY_TIMESTAMPTZ = 1185;
  const OID_ARRAY_NUMERIC = 1231;
  const OID_ARRAY_JSON = 199;
  const OID_ARRAY_JSONB = 3807;

  const parseString = (val: string): string => val;

  const parseJson = (val: string): unknown => {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  };

  const parseBytea = (val: string): string => formatBytea(val);

  const parseTimestamp = (val: string): string => {
    if (!val) return val;
    try {
      const d = new Date(
        val.includes('Z') || val.includes('+')
          ? val
          : `${val.replace(' ', 'T')}Z`,
      );
      return Number.isNaN(d.getTime()) ? val : d.toISOString();
    } catch {
      return val;
    }
  };

  const parseTimestamptz = (val: string): string => {
    if (!val) return val;
    try {
      const d = new Date(val);
      return Number.isNaN(d.getTime()) ? val : d.toISOString();
    } catch {
      return val;
    }
  };

  interface ArrayParserHelper {
    create(source: string, transform: (entry: string) => unknown): { parse(): unknown[] };
  }

  const parseArray = (val: string, itemParser: (v: string) => unknown): unknown[] => {
    try {
      const helper = pg.types.arrayParser as unknown as ArrayParserHelper;
      return helper.create(val, itemParser).parse();
    } catch {
      return [val];
    }
  };

  return {
    getTypeParser(oid: number, format?: string) {
      switch (oid) {
        case OID_INT8:
        case OID_NUMERIC:
          return parseString;
        case OID_DATE:
          return parseString; // keep as YYYY-MM-DD
        case OID_TIMESTAMPTZ:
          return parseTimestamptz;
        case OID_TIMESTAMP:
          return parseTimestamp;
        case OID_JSON:
        case OID_JSONB:
          return parseJson;
        case OID_BYTEA:
          return parseBytea;

        // Arrays
        case OID_ARRAY_INT8:
          return (val: string) => parseArray(val, parseString);
        case OID_ARRAY_NUMERIC:
          return (val: string) => parseArray(val, parseString);
        case OID_ARRAY_DATE:
          return (val: string) => parseArray(val, parseString);
        case OID_ARRAY_TIMESTAMPTZ:
          return (val: string) => parseArray(val, parseTimestamptz);
        case OID_ARRAY_TIMESTAMP:
          return (val: string) => parseArray(val, parseTimestamp);
        case OID_ARRAY_JSON:
        case OID_ARRAY_JSONB:
          return (val: string) => parseArray(val, parseJson);
        case OID_ARRAY_BYTEA:
          return (val: string) => parseArray(val, parseBytea);

        default: {
          const defaultParser = pg.types.getTypeParser(oid, (format ?? 'text') as 'text');
          if (defaultParser) {
            return defaultParser;
          }
          // Unknown types fallback to raw text form
          return parseString;
        }
      }
    },
  };
}

/**
 * Converts a database value to a JSON-safe value.
 * Handles BigInt -> string, Date -> ISO string, Buffer -> bytea summary,
 * and recursively maps arrays and plain objects.
 */
export function toJsonValue(value: unknown, typeName?: string): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Buffer.isBuffer(value)) {
    return formatBytea(value);
  }
  if (typeof value === 'string') {
    if (typeName?.toLowerCase() === 'bytea') {
      return formatBytea(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    const itemTypeName = typeName?.startsWith('_') ? typeName.slice(1) : undefined;
    return value.map((item) => toJsonValue(item, itemTypeName));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // eslint-disable-next-line security/detect-object-injection -- safe plain object traversal
      out[k] = toJsonValue(v);
    }
    return out;
  }
  return String(value);
}

/**
 * Renders a value into cell text for display inside framed tables.
 * NULL renders as '(null)', objects/arrays as compact JSON,
 * and strings are escaped for Markdown table safety.
 */
export function toCellText(value: unknown): string {
  if (value === null || value === undefined) {
    return '(null)';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Buffer.isBuffer(value)) {
    return formatBytea(value);
  }
  if (typeof value === 'string') {
    return escapeMarkdownCell(value);
  }
  if (Array.isArray(value) || typeof value === 'object') {
    const jsonSafe = toJsonValue(value);
    return escapeMarkdownCell(JSON.stringify(jsonSafe));
  }
  return escapeMarkdownCell(String(value));
}
