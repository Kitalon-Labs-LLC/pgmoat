import util from 'node:util';

let originalStdoutWrite: typeof process.stdout.write | null = null;
let originalConsoleLog: typeof console.log | null = null;
let originalConsoleInfo: typeof console.info | null = null;
let guardInstalled = false;
let allowedDepth = 0;

export const STDOUT_GUARD_ERROR_MESSAGE =
  'CRITICAL: Unauthorized write to process.stdout in stdio mode. All logs and diagnostic output must go to stderr.';

/**
 * Installs a guard on process.stdout.write for stdio transport mode.
 * Any write not wrapped in allowStdoutWrite() throws an Error in non-production,
 * or logs a critical message in production.
 */
export function installStdoutGuard(onCritical?: (msg: string) => void): () => void {
  if (guardInstalled) {
    return uninstallStdoutGuard;
  }
  guardInstalled = true;
  originalStdoutWrite = process.stdout.write.bind(process.stdout);
  originalConsoleLog = console.log;
  originalConsoleInfo = console.info;

  process.stdout.write = function guardedStdoutWrite(
    chunk: string | Uint8Array,
    encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void,
  ): boolean {
    if (allowedDepth > 0 && originalStdoutWrite) {
      if (typeof encodingOrCb === 'function') {
        return originalStdoutWrite(chunk, encodingOrCb);
      }
      return originalStdoutWrite(chunk, encodingOrCb, cb);
    }

    if (process.env.NODE_ENV !== 'production') {
      throw new Error(STDOUT_GUARD_ERROR_MESSAGE);
    } else {
      if (onCritical) {
        onCritical(STDOUT_GUARD_ERROR_MESSAGE);
      } else {
        process.stderr.write(`[CRITICAL] ${STDOUT_GUARD_ERROR_MESSAGE}\n`);
      }
      return true;
    }
  } as typeof process.stdout.write;

  console.log = function guardedConsoleLog(...args: unknown[]): void {
    process.stdout.write(util.format(...args) + '\n');
  };

  console.info = function guardedConsoleInfo(...args: unknown[]): void {
    process.stdout.write(util.format(...args) + '\n');
  };

  return uninstallStdoutGuard;
}

/**
 * Removes the stdout guard and restores the original process.stdout.write and console functions.
 */
export function uninstallStdoutGuard(): void {
  if (!guardInstalled) return;
  if (originalStdoutWrite) {
    process.stdout.write = originalStdoutWrite;
    originalStdoutWrite = null;
  }
  if (originalConsoleLog) {
    console.log = originalConsoleLog;
    originalConsoleLog = null;
  }
  if (originalConsoleInfo) {
    console.info = originalConsoleInfo;
    originalConsoleInfo = null;
  }
  guardInstalled = false;
  allowedDepth = 0;
}

/**
 * Checks whether the stdout guard is currently active.
 */
export function isStdoutGuardInstalled(): boolean {
  return guardInstalled;
}

/**
 * Executes a function allowing process.stdout.write to bypass the guard.
 * Supports synchronous and asynchronous functions.
 */
export function allowStdoutWrite<T>(fn: () => T): T {
  allowedDepth++;
  try {
    const res = fn();
    if (res && typeof (res as unknown as Promise<unknown>).then === 'function') {
      return (res as unknown as Promise<unknown>).finally(() => {
        allowedDepth--;
      }) as unknown as T;
    }
    allowedDepth--;
    return res;
  } catch (err) {
    allowedDepth--;
    throw err;
  }
}
