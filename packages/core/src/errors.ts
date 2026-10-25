import { type ErrorCode, ERROR_CODES } from './errors.generated.js';

export * from './errors.generated.js';

export function docsUrl(code: ErrorCode): string {
  return `https://kitalonlabs.com/pgmoat#${code}`;
}

export class PgmoatError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly kind: 'refused' | 'error' | 'canceled' = 'refused',
    public readonly hint?: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'PgmoatError';
  }

  get docsUrl(): string {
    return docsUrl(this.code);
  }
}

export function isPgmoatError(err: unknown): err is PgmoatError {
  return err instanceof PgmoatError;
}

export function refuse(
  code: ErrorCode,
  message: string,
  hint?: string,
): PgmoatError {
  // eslint-disable-next-line security/detect-object-injection -- code is typed ErrorCode union
  const def = ERROR_CODES[code];
  return new PgmoatError(
    code,
    message,
    'refused',
    hint ?? def?.fix,
    def?.httpStatus,
  );
}

/**
 * Error for a refused safety check. Refusals marked asDatabaseError carry no
 * hint, so they render exactly like the database errors in postgres/errors.ts;
 * they stay kind 'refused' so the audit log still records them as refusals.
 */
export function safetyError(result: {
  code: ErrorCode;
  message: string;
  asDatabaseError?: true;
}): PgmoatError {
  if (result.asDatabaseError) {
    return new PgmoatError(result.code, result.message, 'refused');
  }
  return refuse(result.code, result.message);
}

export function fail(code: ErrorCode, message: string): PgmoatError {
  // eslint-disable-next-line security/detect-object-injection -- code is typed ErrorCode union
  const def = ERROR_CODES[code];
  return new PgmoatError(code, message, 'error', def?.fix, def?.httpStatus);
}
