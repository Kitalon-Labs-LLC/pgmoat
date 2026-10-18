/**
 * Produces canonical JSON string:
 * 1. Object keys sorted lexicographically (recursive)
 * 2. No extraneous whitespace
 * 3. UTF-8 safe
 * 4. undefined properties omitted; null preserved
 * 5. Numbers serialized via standard JSON formatting
 */
export function canonicalJson(val: unknown): string {
  if (val === null) {
    return 'null';
  }
  if (val === undefined) {
    return '';
  }
  if (typeof val === 'number') {
    return Number.isFinite(val) ? String(val) : 'null';
  }
  if (typeof val === 'boolean') {
    return val ? 'true' : 'false';
  }
  if (typeof val === 'string') {
    return JSON.stringify(val);
  }
  if (typeof val === 'bigint') {
    return JSON.stringify(val.toString());
  }
  if (val instanceof Date) {
    return JSON.stringify(val.toISOString());
  }
  if (Array.isArray(val)) {
    const items = val.map((item) => (item === undefined ? 'null' : canonicalJson(item)));
    return `[${items.join(',')}]`;
  }
  if (typeof val === 'object') {
    const sortedKeys = Object.keys(val as Record<string, unknown>).sort();
    const pairs: string[] = [];

    for (const k of sortedKeys) {
      // eslint-disable-next-line security/detect-object-injection
      const v = (val as Record<string, unknown>)[k];
      if (v !== undefined && typeof v !== 'function' && typeof v !== 'symbol') {
        pairs.push(`${JSON.stringify(k)}:${canonicalJson(v)}`);
      }
    }
    return `{${pairs.join(',')}}`;
  }

  return JSON.stringify(val);
}
