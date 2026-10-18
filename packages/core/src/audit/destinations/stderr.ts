import type { AuditEntry } from '../../types.js';
import type { AuditDestination } from '../pipeline.js';

export interface StderrDestinationOptions {
  stream?: NodeJS.WritableStream;
}

export class StderrDestination implements AuditDestination {
  readonly name = 'stderr';
  private readonly stream: NodeJS.WritableStream;

  constructor(options?: StderrDestinationOptions) {
    this.stream = options?.stream ?? process.stderr;
  }

  async write(entries: readonly AuditEntry[]): Promise<void> {
    for (const entry of entries) {
      const line = JSON.stringify(entry) + '\n';
      const ok = this.stream.write(line);
      if (!ok && 'once' in this.stream && typeof this.stream.once === 'function') {
        await new Promise<void>((resolve) => {
          this.stream.once('drain', () => resolve());
        });
      }
    }
  }

  async close(): Promise<void> {
    // No-op for stderr
  }
}
