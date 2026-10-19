import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CLI_PATH = join(__dirname, '../../cli/dist/bin.mjs');

function measureCliColdStart(): Promise<{ durationMs: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const proc = spawn(process.execPath, [CLI_PATH, '--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    });

    let stdout = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.on('close', (code) => {
      const durationMs = performance.now() - start;
      if (code === 0) {
        resolve({ durationMs, stdout });
      } else {
        reject(new Error(`CLI exited with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

describe('Startup Latency Benchmarks (NFR-PERF-03)', () => {
  it('verifies cold process execution to version response is under 1.0 s', async () => {
    const runs = 5;
    const durations: number[] = [];

    for (let i = 0; i < runs; i++) {
      const { durationMs, stdout } = await measureCliColdStart();
      expect(stdout).toContain('pgmoat');
      durations.push(durationMs);
    }

    const min = Math.min(...durations);
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    console.log(`[BENCH] CLI Cold Start min: ${min.toFixed(1)} ms, avg: ${avg.toFixed(1)} ms`);

    expect(min).toBeLessThan(1000.0);
  });
});
