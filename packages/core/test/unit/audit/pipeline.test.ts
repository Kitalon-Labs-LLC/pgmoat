import { describe, it, expect, vi } from 'vitest';
import { AuditPipeline, type AuditDestination, type AuditPipelineLogger, type Clock } from '../../../src/audit/pipeline.js';
import { Chain } from '../../../src/audit/chain.js';
import { buildEntry, type EntryMeta, type RequestOutcome } from '../../../src/audit/entry.js';
import type { AuditEntry, RequestContext } from '../../../src/types.js';

class MockDestination implements AuditDestination {
  public name: string;
  public written: AuditEntry[] = [];
  public failCount = 0;
  public closed = false;

  constructor(name = 'mock') {
    this.name = name;
  }

  async write(entries: readonly AuditEntry[]): Promise<void> {
    if (this.failCount > 0) {
      this.failCount--;
      throw new Error(`Simulated write failure on ${this.name}`);
    }
    this.written.push(...entries);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeClock implements Clock {
  private currentTime: number;

  constructor(startTime = 1000) {
    this.currentTime = startTime;
  }

  now(): number {
    return this.currentTime;
  }

  advance(ms: number): void {
    this.currentTime += ms;
  }
}

function createDummyEntry(query = 'SELECT 1', durationMs = 5): AuditEntry {
  const ctx: RequestContext = {
    requestId: '01JAB3W8K2Q9ABCDEF01234567',
    instanceId: 'inst-1',
    startedAt: new Date('2026-10-18T12:00:00.000Z'),
    transport: 'stdio',
    protocolVersion: '2026-07-28',
    client: { name: 'claude-desktop', version: '1.2.3' },
    principal: { kind: 'local', sub: 'local', scopes: new Set(), claims: {} },
    traceId: 'trace-123',
    tool: 'query',
    params: { sql: query },
    meta: {},
    signal: new AbortController().signal,
    warnings: [],
    sqlExecuted: query,
  };
  const outcome: RequestOutcome = {
    status: 'success',
    rowsReturned: 1,
    rowsAffected: null,
  };
  const meta: EntryMeta = {
    budgetMaxRows: 200,
    budgetMaxQueryMs: 5000,
    durationMs,
  };
  return buildEntry(ctx, outcome, meta);
}

describe('AuditPipeline', () => {
  it('flushes entries in order to destination', async () => {
    const chain = new Chain('inst-1');
    const dest = new MockDestination();
    const clock = new FakeClock();
    const pipeline = new AuditPipeline({
      chain,
      destinations: [dest],
      flushIntervalMs: 0, // manual flush
      clock,
    });

    const e1 = createDummyEntry('SELECT 1');
    const e2 = createDummyEntry('SELECT 2');

    expect(pipeline.emit(e1)).toBe(true);
    expect(pipeline.emit(e2)).toBe(true);
    expect(pipeline.queueLength).toBe(2);
    expect(dest.written.length).toBe(0);

    await pipeline.flush();

    expect(dest.written.length).toBe(2);
    expect(dest.written[0].seq).toBe(0);
    expect(dest.written[1].seq).toBe(1);
    expect(dest.written[0].sql_executed).toContain('SELECT 1');
    expect(dest.written[1].sql_executed).toContain('SELECT 2');
    expect(pipeline.queueLength).toBe(0);
    expect(pipeline.bufferedBytes).toBe(0);

    await pipeline.shutdown();
    expect(dest.closed).toBe(true);
  });

  it('retries with exponential backoff on destination failure and recovers backlog', async () => {
    const chain = new Chain('inst-1');
    const dest = new MockDestination();
    const clock = new FakeClock(1000);
    const pipeline = new AuditPipeline({
      chain,
      destinations: [dest],
      flushIntervalMs: 0,
      clock,
    });

    dest.failCount = 1; // fail once

    const e1 = createDummyEntry('SELECT 1');
    pipeline.emit(e1);

    // First flush fails
    await pipeline.flush();
    expect(dest.written.length).toBe(0);
    expect(pipeline.bufferedBytes).toBeGreaterThan(0);

    // Clock has not advanced enough (nextRetryAt is 1000 + 100 = 1100)
    const e2 = createDummyEntry('SELECT 2');
    pipeline.emit(e2);

    clock.advance(50); // now 1050 < 1100
    await pipeline.flush();
    expect(dest.written.length).toBe(0); // still in retry backoff

    // Advance clock past retry backoff
    clock.advance(60); // now 1110 >= 1100
    await pipeline.flush();

    expect(dest.written.length).toBe(2);
    expect(dest.written[0].seq).toBe(0);
    expect(dest.written[1].seq).toBe(1);
    expect(pipeline.bufferedBytes).toBe(0);

    await pipeline.shutdown();
  });

  it('drops entries when buffer is full, calls noteDrop, and preserves seq', async () => {
    const chain = new Chain('inst-1');
    const dest = new MockDestination();
    const clock = new FakeClock(1000);
    const mockLogger: AuditPipelineLogger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    };

    // Buffer limit: enough for 1 entry (~750 bytes) but not 2
    const pipeline = new AuditPipeline({
      chain,
      destinations: [dest],
      bufferMaxBytes: 1200,
      flushIntervalMs: 0,
      clock,
      logger: mockLogger,
    });

    const e1 = createDummyEntry('SELECT 1');
    const e2 = createDummyEntry('SELECT 2');
    const e3 = createDummyEntry('SELECT 3');

    const accepted1 = pipeline.emit(e1);
    expect(accepted1).toBe(true);

    // Second entry exceeds buffer and triggers immediate critical error log
    const accepted2 = pipeline.emit(e2);
    expect(accepted2).toBe(false);
    expect(pipeline.totalDropped).toBe(1);

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('pgmoat CRITICAL audit buffer full; dropped 1 entries in the last minute (PGM-502)'),
    );

    // Third entry also dropped, but throttled within 60s window
    const accepted3 = pipeline.emit(e3);
    expect(accepted3).toBe(false);
    expect(pipeline.totalDropped).toBe(2);

    // Only 1 log call so far
    expect(mockLogger.error).toHaveBeenCalledTimes(1);

    // Advance clock past 60s
    clock.advance(60_001);
    const acceptedDropAgain = pipeline.emit(e3);
    expect(acceptedDropAgain).toBe(false);
    expect(pipeline.totalDropped).toBe(3);

    // Now 2nd log call fired reporting dropped count
    expect(mockLogger.error).toHaveBeenCalledTimes(2);

    // Flush the accepted entry
    await pipeline.flush();
    expect(dest.written.length).toBe(1);
    expect(dest.written[0].seq).toBe(0);
    expect(dest.written[0].dropped_since_last).toBe(0);

    // Emit another entry now that buffer is clear
    const e4 = createDummyEntry('SELECT 4');
    const accepted4 = pipeline.emit(e4);
    expect(accepted4).toBe(true);

    await pipeline.flush();
    expect(dest.written.length).toBe(2);
    // Notice: seq is 1, and dropped_since_last is 3!
    expect(dest.written[1].seq).toBe(1);
    expect(dest.written[1].dropped_since_last).toBe(3);

    await pipeline.shutdown();
  });

  it('emit is synchronous and fast (never awaits)', () => {
    const chain = new Chain('inst-1');
    const dest = new MockDestination();
    const pipeline = new AuditPipeline({
      chain,
      destinations: [dest],
      flushIntervalMs: 0,
    });

    const entry = createDummyEntry('SELECT 1');
    const start = performance.now();
    const count = 100;
    for (let i = 0; i < count; i++) {
      const res = pipeline.emit(entry);
      expect(typeof res).toBe('boolean');
    }
    const elapsed = performance.now() - start;

    // 100 entries should take a few milliseconds synchronously
    expect(elapsed).toBeLessThan(1000);
    expect(pipeline.queueLength).toBe(100);
  });

  it('triggers immediate flush when immediateFlushCount is reached', async () => {
    const chain = new Chain('inst-1');
    const dest = new MockDestination();
    const pipeline = new AuditPipeline({
      chain,
      destinations: [dest],
      flushIntervalMs: 0,
      immediateFlushCount: 5,
    });

    for (let i = 0; i < 4; i++) {
      pipeline.emit(createDummyEntry(`SELECT ${i}`));
    }
    expect(dest.written.length).toBe(0);

    // 5th entry triggers immediate flush
    pipeline.emit(createDummyEntry('SELECT 4'));

    // Wait a tick for the async flush promise
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(dest.written.length).toBe(5);

    await pipeline.shutdown();
  });

  it('shutdown drains queued entries and closes destinations', async () => {
    const chain = new Chain('inst-1');
    const dest = new MockDestination();
    const pipeline = new AuditPipeline({
      chain,
      destinations: [dest],
      flushIntervalMs: 100,
    });

    pipeline.emit(createDummyEntry('SELECT 100'));
    pipeline.emit(createDummyEntry('SELECT 200'));

    await pipeline.shutdown(1000);

    expect(dest.closed).toBe(true);
    expect(dest.written.length).toBe(2);

    // Reject emitting after close
    const rejected = pipeline.emit(createDummyEntry('SELECT 300'));
    expect(rejected).toBe(false);
  });
});
