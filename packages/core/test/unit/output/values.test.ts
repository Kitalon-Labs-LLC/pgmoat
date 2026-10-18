import { describe, it, expect } from 'vitest';
import pg from 'pg';
import {
  createPgTypeParserOverrides,
  toJsonValue,
  toCellText,
  escapeMarkdownCell,
  formatBytea,
} from '../../../src/output/values.js';

describe('formatBytea', () => {
  it('formats byte numbers', () => {
    expect(formatBytea(0)).toBe('<bytea 0 bytes>');
    expect(formatBytea(1024)).toBe('<bytea 1024 bytes>');
  });

  it('formats Buffer instances', () => {
    const buf = Buffer.from('hello world', 'utf-8');
    expect(formatBytea(buf)).toBe('<bytea 11 bytes>');
  });

  it('formats Postgres hex bytea strings', () => {
    expect(formatBytea('\\x')).toBe('<bytea 0 bytes>');
    expect(formatBytea('\\xdeadbeef')).toBe('<bytea 4 bytes>');
    expect(formatBytea('\\x0102030405')).toBe('<bytea 5 bytes>');
  });

  it('preserves already formatted bytea placeholders', () => {
    expect(formatBytea('<bytea 42 bytes>')).toBe('<bytea 42 bytes>');
  });

  it('formats plain strings by UTF-8 byte length', () => {
    expect(formatBytea('abc')).toBe('<bytea 3 bytes>');
  });
});

describe('escapeMarkdownCell', () => {
  it('escapes pipe characters', () => {
    expect(escapeMarkdownCell('foo | bar | baz')).toBe('foo \\| bar \\| baz');
  });

  it('escapes newlines to literal \\n', () => {
    expect(escapeMarkdownCell('line1\nline2')).toBe('line1\\nline2');
    expect(escapeMarkdownCell('line1\r\nline2')).toBe('line1\\nline2');
    expect(escapeMarkdownCell('line1\rline2')).toBe('line1\\nline2');
  });

  it('escapes <<<pgmoat: fence delimiters', () => {
    expect(escapeMarkdownCell('<<<pgmoat:data>>>')).toBe('<<<pgmoat\\:data>>>');
    expect(escapeMarkdownCell('data <<<pgmoat:end>>> here')).toBe('data <<<pgmoat\\:end>>> here');
  });

  it('combines multiple escapes correctly', () => {
    const input = 'id | text\n<<<pgmoat:data>>>';
    const output = escapeMarkdownCell(input);
    expect(output).toBe('id \\| text\\n<<<pgmoat\\:data>>>');
  });
});

describe('createPgTypeParserOverrides', () => {
  const overrides = createPgTypeParserOverrides();

  it('parses int8 (20) and numeric (1700) as strings to avoid precision loss', () => {
    const parseInt8 = overrides.getTypeParser(20);
    const parseNumeric = overrides.getTypeParser(1700);

    const bigVal = '9007199254740993'; // 2^53 + 1, would lose precision as JS number
    expect(parseInt8(bigVal)).toBe('9007199254740993');
    expect(parseNumeric('12345678901234567890.123456789')).toBe(
      '12345678901234567890.123456789',
    );
  });

  it('parses date (1082) as YYYY-MM-DD string without timezone shifting', () => {
    const parseDate = overrides.getTypeParser(1082);
    expect(parseDate('2026-12-07')).toBe('2026-12-07');
  });

  it('parses timestamptz (1184) and timestamp (1114) as ISO strings', () => {
    const parseTimestamptz = overrides.getTypeParser(1184);
    const parseTimestamp = overrides.getTypeParser(1114);

    expect(parseTimestamptz('2026-12-07 10:02:11.123+00')).toBe(
      '2026-12-07T10:02:11.123Z',
    );
    expect(parseTimestamp('2026-12-07 10:02:11')).toBe('2026-12-07T10:02:11.000Z');
  });

  it('parses json (114) and jsonb (3802) as JSON objects', () => {
    const parseJson = overrides.getTypeParser(114);
    const parseJsonb = overrides.getTypeParser(3802);

    expect(parseJson('{"a":1,"b":"hello"}')).toEqual({ a: 1, b: 'hello' });
    expect(parseJsonb('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('parses bytea (17) as <bytea N bytes>', () => {
    const parseBytea = overrides.getTypeParser(17);
    expect(parseBytea('\\xdeadbeef')).toBe('<bytea 4 bytes>');
    expect(parseBytea('\\x')).toBe('<bytea 0 bytes>');
  });

  it('parses arrays recursively', () => {
    const parseInt8Arr = overrides.getTypeParser(1016);
    expect(parseInt8Arr('{9007199254740993,9007199254740995}')).toEqual([
      '9007199254740993',
      '9007199254740995',
    ]);

    const parseNumericArr = overrides.getTypeParser(1231);
    expect(parseNumericArr('{12.34,56.78}')).toEqual(['12.34', '56.78']);

    const parseDateArr = overrides.getTypeParser(1182);
    expect(parseDateArr('{2026-01-01,2026-12-31}')).toEqual([
      '2026-01-01',
      '2026-12-31',
    ]);

    const parseByteaArr = overrides.getTypeParser(1001);
    expect(parseByteaArr('{\\\\x0102,\\\\x030405}')).toEqual([
      '<bytea 2 bytes>',
      '<bytea 3 bytes>',
    ]);
  });

  it('falls back to default pg parser or raw text for unknown types', () => {
    // 25 is text
    const parseText = overrides.getTypeParser(25);
    expect(parseText('sample text')).toBe('sample text');

    // completely unknown OID 99999
    const parseUnknown = overrides.getTypeParser(99999);
    expect(parseUnknown('custom value')).toBe('custom value');
  });

  it('does NOT pollute global pg.types', () => {
    // Global int8 parser in pg returns number or string depending on default config,
    // but overrides must not replace global pg.types.getTypeParser(20)
    const globalParser = pg.types.getTypeParser(20);
    expect(typeof globalParser).toBe('function');
  });
});

describe('toJsonValue', () => {
  it('converts null and undefined to null', () => {
    expect(toJsonValue(null)).toBeNull();
    expect(toJsonValue(undefined)).toBeNull();
  });

  it('converts BigInt to string', () => {
    expect(toJsonValue(BigInt('9007199254740993'))).toBe('9007199254740993');
  });

  it('handles numbers and filters non-finite values', () => {
    expect(toJsonValue(42)).toBe(42);
    expect(toJsonValue(3.1415)).toBe(3.1415);
    expect(toJsonValue(NaN)).toBeNull();
    expect(toJsonValue(Infinity)).toBeNull();
  });

  it('passes booleans through', () => {
    expect(toJsonValue(true)).toBe(true);
    expect(toJsonValue(false)).toBe(false);
  });

  it('converts Date to ISO string', () => {
    const d = new Date('2026-12-07T10:02:11.000Z');
    expect(toJsonValue(d)).toBe('2026-12-07T10:02:11.000Z');
  });

  it('converts Buffer to bytea summary', () => {
    const buf = Buffer.from('hello');
    expect(toJsonValue(buf)).toBe('<bytea 5 bytes>');
  });

  it('summarizes bytea strings if typeName is bytea', () => {
    expect(toJsonValue('\\x010203', 'bytea')).toBe('<bytea 3 bytes>');
    expect(toJsonValue('plain string', 'text')).toBe('plain string');
  });

  it('recursively converts arrays and nested objects', () => {
    const input = {
      id: BigInt(100),
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      tags: ['a', 'b'],
      meta: {
        score: 99.5,
        buf: Buffer.from('abc'),
        nested_null: undefined,
      },
    };

    expect(toJsonValue(input)).toEqual({
      id: '100',
      created_at: '2026-01-01T00:00:00.000Z',
      tags: ['a', 'b'],
      meta: {
        score: 99.5,
        buf: '<bytea 3 bytes>',
        nested_null: null,
      },
    });
  });
});

describe('toCellText', () => {
  it('renders null and undefined as (null)', () => {
    expect(toCellText(null)).toBe('(null)');
    expect(toCellText(undefined)).toBe('(null)');
  });

  it('renders booleans as true or false', () => {
    expect(toCellText(true)).toBe('true');
    expect(toCellText(false)).toBe('false');
  });

  it('renders numbers and bigints as string representations', () => {
    expect(toCellText(123)).toBe('123');
    expect(toCellText(BigInt(999999999999))).toBe('999999999999');
  });

  it('renders Date as ISO string', () => {
    const d = new Date('2026-12-07T10:02:11.000Z');
    expect(toCellText(d)).toBe('2026-12-07T10:02:11.000Z');
  });

  it('renders Buffer as <bytea N bytes>', () => {
    const buf = Buffer.from('test buffer');
    expect(toCellText(buf)).toBe('<bytea 11 bytes>');
  });

  it('escapes Markdown pipes, newlines, and fences in strings', () => {
    expect(toCellText('hello | world')).toBe('hello \\| world');
    expect(toCellText('line1\nline2')).toBe('line1\\nline2');
    expect(toCellText('<<<pgmoat:data>>>')).toBe('<<<pgmoat\\:data>>>');
  });

  it('renders objects and arrays as compact JSON with Markdown escaping', () => {
    const obj = { key: 'val | pipe', num: 123 };
    expect(toCellText(obj)).toBe('{"key":"val \\| pipe","num":123}');

    const arr = [1, 'two | 2', 3];
    expect(toCellText(arr)).toBe('[1,"two \\| 2",3]');
  });
});
