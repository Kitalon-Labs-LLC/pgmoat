/* eslint-disable security/detect-object-injection */
import { createHash } from 'node:crypto';
import { deparse as defaultDeparse } from 'pgsql-deparser';
import type { ParseResult } from '@pgsql/types';

function isLocationField(key: string): boolean {
  return (
    key === 'location' ||
    key === 'stmt_location' ||
    key === 'stmt_len' ||
    key === 'list_start' ||
    key === 'list_end' ||
    key === 'rexpr_list_start' ||
    key === 'rexpr_list_end' ||
    key.endsWith('_location') ||
    key.endsWith('_len')
  );
}

function replaceConstantsAndStripLocations(node: unknown): unknown {
  if (node === null || typeof node !== 'object') {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map(replaceConstantsAndStripLocations);
  }
  const obj = node as Record<string, unknown>;
  if ('A_Const' in obj) {
    return { A_Const: { sval: { sval: '?' } } };
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isLocationField(key)) {
      continue;
    }
    result[key] = replaceConstantsAndStripLocations(value);
  }
  return result;
}

/**
 * Computes a deterministic 16-hex query fingerprint from an AST.
 * Replaces every constant with a placeholder, strips locations,
 * deparses, collapses whitespace, and hashes with SHA-256 (first 16 hex characters).
 */
export async function fingerprint(
  tree: ParseResult,
  deparseFn: (t: ParseResult) => Promise<string> = defaultDeparse,
): Promise<string> {
  const cloned = structuredClone(tree);
  const normalizedTree = replaceConstantsAndStripLocations(cloned) as ParseResult;

  const deparsed = await deparseFn(normalizedTree);
  const collapsed = deparsed.replace(/\s+/g, ' ').trim();

  return createHash('sha256').update(collapsed, 'utf8').digest('hex').slice(0, 16);
}
