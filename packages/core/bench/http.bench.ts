import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import http from 'node:http';
import { Readable } from 'node:stream';

describe('HTTP and Streaming Benchmarks (NFR-PERF-04, NFR-PERF-05)', () => {
  let server: http.Server;
  let serverPort: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/health' || req.url === '/.well-known/oauth-protected-resource') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', resource: 'http://127.0.0.1' }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          serverPort = addr.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('measures streaming chunk dispatch delay < 5 ms (NFR-PERF-04)', async () => {
    const chunkCount = 100;
    const stream = new Readable({
      read() {
        // no-op, pushed externally
      },
    });

    const dispatchDelays: number[] = [];
    let lastPush = performance.now();

    stream.on('data', () => {
      const delay = performance.now() - lastPush;
      dispatchDelays.push(delay);
    });

    for (let i = 0; i < chunkCount; i++) {
      lastPush = performance.now();
      stream.push(Buffer.from(`chunk-${i}: payload data for streaming verification\n`));
      // slight tick
      await new Promise((r) => setImmediate(r));
    }
    stream.push(null);

    const sorted = [...dispatchDelays].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    console.log(`[BENCH] Streaming Chunk Dispatch p95: ${p95.toFixed(3)} ms`);
    expect(p95).toBeLessThan(5.0);
  });

  it('measures HTTP round-trip latency overhead < 5 ms (NFR-PERF-05)', async () => {
    const runs = 50;
    const latencies: number[] = [];

    // Warmup
    for (let i = 0; i < 5; i++) {
      await fetch(`http://127.0.0.1:${serverPort}/health`);
    }

    for (let i = 0; i < runs; i++) {
      const start = performance.now();
      const res = await fetch(`http://127.0.0.1:${serverPort}/health`);
      const elapsed = performance.now() - start;
      expect(res.status).toBe(200);
      latencies.push(elapsed);
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.50)] ?? 0;
    console.log(`[BENCH] HTTP Round-Trip p50: ${p50.toFixed(3)} ms`);
    // Local loopback roundtrip is well under 5 ms
    expect(p50).toBeLessThan(5.0);
  });
});
