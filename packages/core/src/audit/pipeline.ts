import type { AuditEntry } from '../types.js';
import type { AuditConfigT } from '../config/schema.js';
import { redactEntrySync } from './redact.js';
import { type Chain } from './chain.js';

export interface AuditDestination {
  readonly name: string;
  write(entries: readonly AuditEntry[]): Promise<void>;
  close(): Promise<void>;
}

export interface Clock {
  now(): number;
}

export interface AuditPipelineLogger {
  error(msg: string, ...args: unknown[]): void;
  warn?(msg: string, ...args: unknown[]): void;
  info?(msg: string, ...args: unknown[]): void;
}

export interface AuditPipelineOptions {
  chain: Chain;
  destinations: AuditDestination[];
  auditConfig?: Partial<AuditConfigT> | undefined;
  bufferMaxBytes?: number;
  flushIntervalMs?: number;
  immediateFlushCount?: number;
  logger?: AuditPipelineLogger;
  clock?: Clock;
}

interface DestinationState {
  destination: AuditDestination;
  pendingRetryBatch: AuditEntry[];
  retryBackoffMs: number;
  nextRetryAt: number;
}

/**
 * Bounded, asynchronous audit pipeline with drop accounting and backpressure.
 *
 * Requirements:
 * - emit() is synchronous, fast, and never awaits
 * - If buffer is full, entry is dropped, chain.noteDrop() is called, and seq is preserved
 * - Flushes automatically via interval and when immediateFlushCount is reached
 * - Backoff retries per destination (100 ms doubling up to 30 s)
 * - Graceful shutdown with deadline
 */
export class AuditPipeline {
  private readonly chain: Chain;
  private readonly destinations: DestinationState[];
  private readonly auditConfig?: Partial<AuditConfigT> | undefined;
  private readonly bufferMaxBytes: number;
  private readonly flushIntervalMs: number;
  private readonly immediateFlushCount: number;
  private readonly logger: AuditPipelineLogger;
  private readonly clock: Clock;

  private queuedEntries: AuditEntry[] = [];
  private queuedBytes = 0;
  private droppedTotal = 0;
  private droppedInCurrentWindow = 0;
  private lastCriticalLoggedAt = -60_000;

  private intervalTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private isClosed = false;

  constructor(options: AuditPipelineOptions) {
    this.chain = options.chain;
    this.auditConfig = options.auditConfig;
    this.bufferMaxBytes = options.bufferMaxBytes ?? 10_485_760; // 10 MB
    this.flushIntervalMs = options.flushIntervalMs ?? 100;
    this.immediateFlushCount = options.immediateFlushCount ?? 1000;
    this.logger = options.logger ?? console;
    this.clock = options.clock ?? { now: () => Date.now() };

    this.destinations = options.destinations.map((dest) => ({
      destination: dest,
      pendingRetryBatch: [],
      retryBackoffMs: 100,
      nextRetryAt: 0,
    }));

    if (this.flushIntervalMs > 0) {
      this.intervalTimer = setInterval(() => {
        void this.flush();
      }, this.flushIntervalMs);
      if (this.intervalTimer.unref) {
        this.intervalTimer.unref();
      }
    }
  }

  get totalDropped(): number {
    return this.droppedTotal;
  }

  get bufferedBytes(): number {
    let pendingRetryBytes = 0;
    for (const d of this.destinations) {
      for (const e of d.pendingRetryBatch) {
        pendingRetryBytes += Buffer.byteLength(JSON.stringify(e), 'utf-8');
      }
    }
    return this.queuedBytes + pendingRetryBytes;
  }

  get queueLength(): number {
    return this.queuedEntries.length;
  }

  /**
   * Enqueues an entry for auditing. Synchronous, non-blocking, fast.
   */
  emit(rawEntry: AuditEntry): boolean {
    if (this.isClosed) {
      this.chain.noteDrop();
      this.droppedTotal += 1;
      return false;
    }

    // 1. Synchronous secret redaction
    const redacted = redactEntrySync(rawEntry, this.auditConfig);

    // 2. Estimate serialized byte size
    const jsonStr = JSON.stringify(redacted);
    const size = Buffer.byteLength(jsonStr, 'utf-8');

    // 3. Check buffer capacity
    if (this.bufferedBytes + size > this.bufferMaxBytes) {
      // Drop path: DO NOT seal (so no seq consumed), record drop on chain
      this.chain.noteDrop();
      this.droppedTotal += 1;
      this.droppedInCurrentWindow += 1;

      const now = this.clock.now();
      if (now - this.lastCriticalLoggedAt >= 60_000) {
        this.logger.error(
          `pgmoat CRITICAL audit buffer full; dropped ${this.droppedInCurrentWindow} entries in the last minute (PGM-502)`,
        );
        this.lastCriticalLoggedAt = now;
        this.droppedInCurrentWindow = 0;
      }

      return false;
    }

    // 4. Accept path: seal cryptographically and enqueue
    const sealed = this.chain.seal(redacted);
    this.queuedEntries.push(sealed);
    this.queuedBytes += size;

    if (this.queuedEntries.length >= this.immediateFlushCount) {
      void this.flush();
    }

    return true;
  }

  /**
   * Flushes queued entries to all configured destinations.
   */
  async flush(): Promise<void> {
    if (this.isFlushing) {
      return;
    }
    this.isFlushing = true;

    try {
      const batch = this.queuedEntries;
      this.queuedEntries = [];
      this.queuedBytes = 0;

      const now = this.clock.now();

      await Promise.allSettled(
        this.destinations.map(async (state) => {
          // Prepare entries for this destination
          let entriesToSend: AuditEntry[] = [];

          if (state.pendingRetryBatch.length > 0) {
            if (now >= state.nextRetryAt) {
              entriesToSend = [...state.pendingRetryBatch, ...batch];
            } else {
              // Retry backoff not reached yet; add new batch to pending retry
              state.pendingRetryBatch.push(...batch);
              return;
            }
          } else {
            entriesToSend = batch;
          }

          if (entriesToSend.length === 0) {
            return;
          }

          try {
            await state.destination.write(entriesToSend);
            // Success: clear pending batch and reset backoff
            state.pendingRetryBatch = [];
            state.retryBackoffMs = 100;
            state.nextRetryAt = 0;
          } catch {
            // Failure: preserve entries for next retry with backoff
            state.pendingRetryBatch = entriesToSend;
            state.nextRetryAt = now + state.retryBackoffMs;
            state.retryBackoffMs = Math.min(30_000, state.retryBackoffMs * 2);
          }
        }),
      );
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Shuts down the pipeline gracefully within deadlineMs.
   */
  async shutdown(deadlineMs = 5000): Promise<void> {
    this.isClosed = true;

    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }

    const shutdownWork = async (): Promise<void> => {
      // Drain remaining items
      await this.flush();

      // Close all destinations
      await Promise.allSettled(
        this.destinations.map((d) => d.destination.close()),
      );
    };

    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, deadlineMs);
    });

    try {
      await Promise.race([shutdownWork(), timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
