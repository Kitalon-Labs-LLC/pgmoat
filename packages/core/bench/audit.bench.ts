import { describe, it, expect } from 'vitest';
import * as libpgQuery from 'libpg-query';
import { AuditPipeline, type AuditDestination } from '../src/audit/pipeline.js';
import { Chain } from '../src/audit/chain.js';
import { buildEntry, type RequestOutcome, type EntryMeta } from '../src/audit/entry.js';
import type { AuditEntry, RequestContext } from '../src/types.js';

class BlackholeDestination implements AuditDestination {
  readonly name = 'blackhole';
  async write(): Promise<void> {
    // Drop in memory
  }
  async close(): Promise<void> {
    // No-op
  }
}

function makeRealisticEntry(i: number): AuditEntry {
  const ctx: RequestContext = {
    requestId: `01JAB3W8K2Q9ABCDEF${String(i).padStart(8, '0')}`,
    instanceId: 'inst-bench',
    startedAt: new Date(Date.now() + i),
    transport: 'stdio',
    protocolVersion: '2026-07-28',
    client: { name: 'claude-desktop', version: '1.2.3' },
    principal: { kind: 'local', sub: 'local', scopes: new Set(), claims: {} },
    traceId: 'trace-123',
    tool: 'query',
    params: {
      password: 'my-super-secret-password',
      apiKey: 'ak_live_secret1234567890',
      limit: 100,
    },
    meta: {},
    signal: new AbortController().signal,
    warnings: [],
    sqlExecuted: `SELECT id, name, email FROM users WHERE tenant_id = 'tnt_123' AND password = 'hunter2_plain_text' LIMIT 100`,
    sqlFingerprint: 'SELECT id, name, email FROM users WHERE tenant_id = $1 AND password = $2 LIMIT $3',
    rls: {
      entries: [
        ['app.tenant_id', 'tnt_123'],
        ['app.secret_key', 'top_secret_token_val'],
      ],
      sources: {
        'app.tenant_id': 'env',
        'app.secret_key': 'env',
      },
    },
  };
  const outcome: RequestOutcome = {
    status: 'success',
    rowsReturned: 50,
    rowsAffected: null,
  };
  const meta: EntryMeta = {
    budgetMaxRows: 200,
    budgetMaxQueryMs: 5000,
    durationMs: 14.5,
  };
  return buildEntry(ctx, outcome, meta);
}

describe('Audit Pipeline Enqueue Benchmark (NFR-PERF-06)', () => {
  it('enqueue p95 is strictly under 1.0 ms over 10,000 realistic entries with redaction', async () => {
    // Preload libpgQuery WebAssembly module if needed
    if (typeof libpgQuery.loadModule === 'function') {
      await libpgQuery.loadModule();
    }

    const chain = new Chain('inst-bench');
    const dest = new BlackholeDestination();
    const pipeline = new AuditPipeline({
      chain,
      destinations: [dest],
      bufferMaxBytes: 100 * 1024 * 1024, // 100 MB so nothing drops
      flushIntervalMs: 0, // avoid background interval during microbench
    });

    // Warmup 100 iterations
    for (let i = 0; i < 100; i++) {
      pipeline.emit(makeRealisticEntry(i));
    }
    await pipeline.flush();

    // 10,000 iterations measurement
    const count = 10_000;
    const durations: number[] = [];

    for (let i = 0; i < count; i++) {
      const entry = makeRealisticEntry(i);
      const t0 = performance.now();
      pipeline.emit(entry);
      durations.push(performance.now() - t0);
    }

    durations.sort((a, b) => a - b);
    const p50 = durations[Math.floor(count * 0.50)]!;
    const p95 = durations[Math.floor(count * 0.95)]!;
    const p99 = durations[Math.floor(count * 0.99)]!;

    console.log(`\n======================================================`);
    console.log(` Audit Pipeline Enqueue Benchmark (${count} iterations)`);
    console.log(`------------------------------------------------------`);
    console.log(`  p50: ${p50.toFixed(4)} ms`);
    console.log(`  p95: ${p95.toFixed(4)} ms`);
    console.log(`  p99: ${p99.toFixed(4)} ms`);
    console.log(`======================================================\n`);

    await pipeline.shutdown();

    if (process.env.SKIP_PERF_ASSERTION !== 'true') {
      expect(p95).toBeLessThan(1.0);
    }
  }, 60000);
});
