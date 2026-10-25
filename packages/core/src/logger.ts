import pino, { type Logger as PinoLogger } from 'pino';
import type { PgmoatConfigT } from './config/schema.js';

export type { PinoLogger };

export interface LoggerOptions {
  readonly level?: string;
}

/**
 * Creates a pino logger instance that writes to file descriptor 2 (stderr).
 * Level is configured from pgmoat configuration or options (default 'info').
 */
export function createLogger(config?: PgmoatConfigT | LoggerOptions): PinoLogger {
  let level = 'info';
  if (config) {
    if ('logging' in config && config.logging?.level) {
      level = config.logging.level;
    } else if ('level' in config && config.level) {
      level = config.level;
    }
  }

  return pino(
    {
      level,
    },
    pino.destination(2),
  );
}
