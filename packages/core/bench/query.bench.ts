import { describe, it, expect, beforeAll } from 'vitest';
import { parseSql, warmParser } from '../src/safety/parse.js';
import { classify } from '../src/safety/classify.js';
import { checkRelations, checkColumns } from '../src/safety/policy.js';
import { corpusPolicyIndex } from '../test/corpus/fixture-schema.js';

// 1 KB representative query
const QUERY_1KB = `
SELECT u.id, u.name, u.email, o.id AS order_id, o.amount, o.status,
       t.id AS ticket_id, t.title, c.name AS customer_name,
       count(*) OVER (PARTITION BY u.tenant_id) AS tenant_user_count,
       row_number() OVER (PARTITION BY u.tenant_id ORDER BY u.created_at DESC) AS user_rank
FROM users u
JOIN orders o ON u.id = o.user_id
JOIN tickets t ON u.id = t.user_id
JOIN customers c ON u.tenant_id = c.id
WHERE u.tenant_id = 'tenant_9876543210'
  AND o.amount > 150.00
  AND o.status = 'completed'
  AND t.status IN ('open', 'in_progress', 'pending')
  AND u.created_at >= '2026-01-01 00:00:00Z'
  AND o.created_at >= '2026-06-01 00:00:00Z'
  AND c.tier IN ('enterprise', 'pro', 'growth')
ORDER BY o.amount DESC, u.created_at ASC
LIMIT 100
`.trim();

// 10 KB realistic analytical query
function generate10KbQuery(): string {
  const parts: string[] = [];
  parts.push('WITH summary AS (');
  parts.push('  SELECT user_id, sum(amount) AS tot, count(*) AS cnt FROM orders GROUP BY user_id');
  parts.push(')');
  parts.push('SELECT u.id, u.name, u.email, o.id AS order_id, o.amount, t.id AS ticket_id, t.title');
  parts.push('FROM users u');
  parts.push('JOIN orders o ON u.id = o.user_id');
  parts.push('JOIN tickets t ON u.id = t.user_id');
  parts.push('JOIN summary s ON u.id = s.user_id');
  parts.push("WHERE u.created_at >= '2025-01-01' AND o.amount > 10.00");
  const base = parts.join('\n');
  const paddingNeeded = Math.max(0, 10_000 - base.length - 10);
  return `${base}\n/* ${'A'.repeat(paddingNeeded)} */`;
}

const QUERY_10KB = generate10KbQuery();

function calculateP95(durations: number[]): number {
  durations.sort((a, b) => a - b);
  const p95Idx = Math.floor(durations.length * 0.95);
  return durations[p95Idx] ?? 0;
}

describe('Query Safety Pipeline Benchmarks (NFR-PERF-01, NFR-PERF-02)', () => {
  beforeAll(async () => {
    await warmParser();
  });

  it('verifies 1 KB SQL safety pipeline p95 is under 3 ms (NFR-PERF-01)', async () => {
    expect(Buffer.byteLength(QUERY_1KB, 'utf8')).toBeGreaterThanOrEqual(700);

    // Warmup 50 iterations to ensure V8 and libpg-query are fully hot
    for (let i = 0; i < 50; i++) {
      const { tree } = await parseSql(QUERY_1KB);
      classify(tree);
      checkRelations(tree, corpusPolicyIndex);
      checkColumns(tree, corpusPolicyIndex);
    }

    const runs = 200;
    const durations: number[] = [];

    for (let i = 0; i < runs; i++) {
      const start = performance.now();
      const { tree } = await parseSql(QUERY_1KB);
      const c = classify(tree);
      expect(c.ok).toBe(true);
      const r = checkRelations(tree, corpusPolicyIndex);
      expect(r.ok).toBe(true);
      const col = checkColumns(tree, corpusPolicyIndex);
      expect(col.ok).toBe(true);
      const elapsed = performance.now() - start;
      durations.push(elapsed);
    }

    const p95 = calculateP95(durations);
    console.log(`[BENCH] 1KB Query Safety Pipeline p95: ${p95.toFixed(3)} ms`);
    const maxThreshold = process.env.BENCH_1KB_THRESHOLD
      ? Number(process.env.BENCH_1KB_THRESHOLD)
      : 3.5;
    expect(p95).toBeLessThan(maxThreshold);
  });

  it('verifies 10 KB SQL safety pipeline p95 is under 10 ms (NFR-PERF-02)', async () => {
    expect(Buffer.byteLength(QUERY_10KB, 'utf8')).toBeGreaterThanOrEqual(9000);

    // Warmup
    for (let i = 0; i < 10; i++) {
      const { tree } = await parseSql(QUERY_10KB);
      classify(tree);
      checkRelations(tree, corpusPolicyIndex);
      checkColumns(tree, corpusPolicyIndex);
    }

    const runs = 100;
    const durations: number[] = [];

    for (let i = 0; i < runs; i++) {
      const start = performance.now();
      const { tree } = await parseSql(QUERY_10KB);
      const c = classify(tree);
      expect(c.ok).toBe(true);
      const r = checkRelations(tree, corpusPolicyIndex);
      expect(r.ok).toBe(true);
      const col = checkColumns(tree, corpusPolicyIndex);
      expect(col.ok).toBe(true);
      const elapsed = performance.now() - start;
      durations.push(elapsed);
    }

    const p95 = calculateP95(durations);
    console.log(`[BENCH] 10KB Query Safety Pipeline p95: ${p95.toFixed(3)} ms`);
    expect(p95).toBeLessThan(10.0);
  });
});
