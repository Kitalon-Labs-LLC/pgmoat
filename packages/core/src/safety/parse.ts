import * as libpgQuery from 'libpg-query';
import type { ParseResult } from '@pgsql/types';
import { refuse, PgmoatError } from '../errors.js';

export interface ParseSqlOptions {
  maxSqlChars?: number;
}

export interface ParseSqlResult {
  tree: ParseResult;
  grammarVersion: number;
}

export async function warmParser(): Promise<void> {
  await libpgQuery.loadModule();
}

export async function parseSql(
  sql: string,
  options?: ParseSqlOptions,
): Promise<ParseSqlResult> {
  const maxSqlChars = options?.maxSqlChars ?? 65_536;

  if (sql.length > maxSqlChars) {
    throw refuse(
      'PGM-206',
      `SQL length (${sql.length}) exceeds maximum allowed (${maxSqlChars})`,
    );
  }

  if (sql.trim().length === 0) {
    throw refuse('PGM-206', 'SQL is empty');
  }

  let tree: ParseResult;
  try {
    tree = await libpgQuery.parse(sql);
  } catch (err: unknown) {
    if (err instanceof PgmoatError) {
      throw err;
    }
    if (libpgQuery.hasSqlDetails(err) && err.sqlDetails) {
      const pos = err.sqlDetails.cursorPosition;
      const msg = err.sqlDetails.message;
      const details = pos !== undefined ? `${msg} at position ${pos}` : msg;
      throw refuse('PGM-206', `SQL could not be parsed: ${details}`);
    }
    if (err instanceof Error) {
      throw refuse('PGM-206', `SQL could not be parsed: ${err.message}`);
    }
    throw refuse('PGM-206', 'SQL could not be parsed');
  }

  if (!tree.stmts || tree.stmts.length === 0) {
    throw refuse(
      'PGM-206',
      'SQL contains no statements (empty or comment-only)',
    );
  }

  const grammarVersion = tree.version ?? 180004;

  return {
    tree,
    grammarVersion,
  };
}
