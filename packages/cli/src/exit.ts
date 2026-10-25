import { isPgmoatError } from '@pgmoat/core';
import { err } from './output.js';

export const EXIT_SUCCESS = 0;
export const EXIT_USER_ERROR = 1;
export const EXIT_CONNECTION_ERROR = 2;
export const EXIT_CONFIG_ERROR = 3;

export function getExitCode(error?: unknown): number {
  if (!error) return EXIT_SUCCESS;

  if (isPgmoatError(error)) {
    // PGM-101 (Cannot connect to Postgres) and PGM-504 (pool exhausted) are connection errors
    if (error.code === 'PGM-101' || error.code === 'PGM-504') {
      return EXIT_CONNECTION_ERROR;
    }
    // 1xx codes are config errors
    if (/^PGM-1\d\d$/.test(error.code)) {
      return EXIT_CONFIG_ERROR;
    }
    // Other errors (0xx, 2xx, 3xx, 4xx, 5xx, 6xx, 7xx)
    return EXIT_USER_ERROR;
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes('econnrefused') ||
      msg.includes('connection refused') ||
      msg.includes('cannot connect') ||
      msg.includes('enotfound')
    ) {
      return EXIT_CONNECTION_ERROR;
    }
  }

  return EXIT_USER_ERROR;
}

export function exitWithError(
  error: unknown,
  details?: Record<string, unknown>,
): never {
  err(error, details);
  const code = getExitCode(error);
  process.exit(code);
}

