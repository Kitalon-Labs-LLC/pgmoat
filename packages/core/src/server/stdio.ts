import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { Transport } from '@modelcontextprotocol/server';
import { createServer } from './create.js';
import { allowStdoutWrite } from './stdout-guard.js';
import { printZeroConfigNotice, type ZeroConfigNoticeOptions } from '../zero-config.js';
import type { Runtime } from '../runtime.js';

export interface StdioServerOptions extends ZeroConfigNoticeOptions {
  readonly isZeroConfig?: boolean;
  readonly transport?: Transport;
}

export interface StdioHandle {
  close(): Promise<void>;
}

/**
 * Serves pgmoat tools over stdio supporting both protocol eras (2025-11-25 and 2026-07-28).
 * Transport writes are permitted through the stdout guard.
 * If zero-config mode is enabled, prints the zero-config notice banner to stderr.
 */
export function startStdio(
  runtime: Runtime,
  options?: StdioServerOptions,
): StdioHandle {
  if (options?.isZeroConfig) {
    printZeroConfigNotice(runtime, options);
  }

  // Create proxy around process.stdout so StdioServerTransport writes
  // pass through allowStdoutWrite()
  const transportStdout = new Proxy(process.stdout, {
    get(target, prop, receiver) {
      if (prop === 'write') {
        return (
          chunk: string | Uint8Array,
          encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
          cb?: (err?: Error | null) => void,
        ): boolean => {
          return allowStdoutWrite(() => {
            if (typeof encodingOrCb === 'function') {
              return target.write(chunk, encodingOrCb);
            }
            return target.write(chunk, encodingOrCb, cb);
          });
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  const transport =
    options?.transport ??
    new StdioServerTransport(process.stdin, transportStdout);

  const innerHandle = serveStdio(
    () => createServer(runtime.toolDeps),
    {
      legacy: 'serve',
      transport,
      onerror: (err) => {
        runtime.logger.error({ err }, 'stdio transport error');
      },
    },
  );

  return {
    async close() {
      await innerHandle.close();
      await runtime.shutdown('stdio-close');
    },
  };
}
