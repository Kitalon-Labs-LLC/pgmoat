import { describe, it, expect } from 'vitest';
import { parseSql, warmParser } from '../src/safety/parse.js';
import { classify } from '../src/safety/classify.js';
import { checkRelations, checkColumns } from '../src/safety/policy.js';
import { corpusPolicyIndex } from '../test/corpus/fixture-schema.js';

// 20 representative ~1KB queries
export const REPRESENTATIVE_QUERIES: string[] = [
  // 1. Multi-join with filters and aggregations
  `SELECT u.id, u.name, u.email, o.id AS order_id, o.amount, o.status, t.id AS ticket_id, t.title, c.name AS customer_name
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
   ORDER BY o.amount DESC, u.created_at ASC`,

  // 2. Window functions with partition and order
  `SELECT u.id, u.name, u.email, u.tenant_id,
          count(*) OVER (PARTITION BY u.tenant_id) AS tenant_user_count,
          row_number() OVER (PARTITION BY u.tenant_id ORDER BY u.created_at DESC) AS user_rank,
          lag(u.created_at, 1) OVER (PARTITION BY u.tenant_id ORDER BY u.created_at) AS prev_created_at,
          lead(u.created_at, 1) OVER (PARTITION BY u.tenant_id ORDER BY u.created_at) AS next_created_at
   FROM users u
   WHERE u.created_at BETWEEN '2026-01-01' AND '2026-12-31'
     AND u.role = 'member'
   ORDER BY u.tenant_id, user_rank ASC`,

  // 3. CTE with aggregation and join
  `WITH monthly_orders AS (
     SELECT user_id,
            date_trunc('month', created_at) AS order_month,
            count(*) AS total_orders,
            sum(amount) AS total_spent,
            avg(amount) AS avg_spent
     FROM orders
     WHERE created_at >= '2026-01-01'
     GROUP BY user_id, date_trunc('month', created_at)
     HAVING count(*) >= 2
   )
   SELECT u.id, u.name, u.email, mo.order_month, mo.total_orders, mo.total_spent, mo.avg_spent
   FROM users u
   JOIN monthly_orders mo ON u.id = mo.user_id
   WHERE mo.total_spent > 500.00
   ORDER BY mo.total_spent DESC`,

  // 4. Multi-condition boolean logic with CASE
  `SELECT o.id, o.user_id, o.amount, o.status,
          CASE WHEN o.amount > 1000 THEN 'whale'
               WHEN o.amount > 200 THEN 'high_value'
               WHEN o.amount > 50 THEN 'medium_value'
               ELSE 'low_value' END AS customer_segment,
          CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END AS is_completed
   FROM orders o
   WHERE (o.status = 'completed' AND o.amount >= 50.0)
      OR (o.status = 'pending' AND o.created_at >= now() - interval '7 days')
      OR (o.user_id IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 10))
   ORDER BY o.created_at DESC`,

  // 5. JSON and string formatting functions
  `SELECT u.id,
          lower(u.email) AS normalized_email,
          concat(u.name, ' (', u.email, ')') AS display_label,
          json_build_object('user_id', u.id, 'name', u.name, 'tenant', u.tenant_id) AS meta_json,
          to_jsonb(u.created_at) AS created_json
   FROM users u
   WHERE length(u.name) >= 3
     AND u.email LIKE '%@example.com'
     AND u.tenant_id IS NOT NULL
   ORDER BY u.id ASC`,

  // 6. Subqueries in WHERE and target list
  `SELECT u.id, u.name,
          (SELECT count(*) FROM orders o WHERE o.user_id = u.id) AS order_count,
          (SELECT sum(amount) FROM orders o WHERE o.user_id = u.id) AS order_sum
   FROM users u
   WHERE u.id IN (SELECT user_id FROM orders WHERE amount > 250)
     AND EXISTS (SELECT 1 FROM tickets t WHERE t.user_id = u.id AND t.status = 'open')
   ORDER BY u.id ASC`,

  // 7. Grouping sets and rollups
  `SELECT o.status, o.user_id, count(*) AS order_cnt, sum(o.amount) AS sum_amount
   FROM orders o
   WHERE o.created_at >= '2026-01-01'
   GROUP BY GROUPING SETS ((o.status, o.user_id), (o.status), ())
   ORDER BY o.status, sum_amount DESC`,

  // 8. Lateral join query
  `SELECT u.id, u.name, latest_order.amount, latest_order.created_at
   FROM users u,
   LATERAL (
     SELECT o.amount, o.created_at
     FROM orders o
     WHERE o.user_id = u.id
     ORDER BY o.created_at DESC
     LIMIT 1
   ) AS latest_order
   WHERE u.tenant_id = 'tnt_alpha'
   ORDER BY latest_order.created_at DESC`,

  // 9. Distinct On query
  `SELECT DISTINCT ON (o.user_id) o.user_id, o.id AS order_id, o.amount, o.created_at
   FROM orders o
   WHERE o.status = 'completed'
     AND o.amount > 20.00
   ORDER BY o.user_id, o.created_at DESC`,

  // 10. Date math and truncation
  `SELECT date_trunc('week', created_at) AS order_week,
          count(*) AS weekly_volume,
          sum(amount) AS weekly_revenue,
          avg(amount) AS weekly_aov
   FROM orders
   WHERE created_at >= '2026-01-01 00:00:00Z'
     AND created_at < '2026-10-01 00:00:00Z'
   GROUP BY date_trunc('week', created_at)
   ORDER BY order_week ASC`,

  // 11. Array operations and unnest
  `SELECT u.id, u.name, array_agg(o.amount ORDER BY o.amount DESC) AS order_amounts
   FROM users u
   JOIN orders o ON u.id = o.user_id
   WHERE o.amount > 10.0
   GROUP BY u.id, u.name
   HAVING array_length(array_agg(o.amount), 1) >= 2
   ORDER BY u.id`,

  // 12. Multiple joins with customer and event filters
  `SELECT e.id, e.event_type, u.email, c.name AS customer_name
   FROM events e
   JOIN users u ON e.id = u.id
   JOIN customers c ON u.tenant_id = c.id
   WHERE e.event_type IN ('login', 'order_placed', 'ticket_opened')
     AND c.tier = 'enterprise'
     AND e.created_at >= now() - interval '30 days'
   ORDER BY e.created_at DESC`,

  // 13. Union of two categorized queries
  `SELECT id, amount, 'high' AS tier FROM orders WHERE amount >= 500
   UNION ALL
   SELECT id, amount, 'medium' AS tier FROM orders WHERE amount BETWEEN 100 AND 499.99
   ORDER BY amount DESC`,

  // 14. Full-text and pattern search query
  `SELECT t.id, t.title, t.status, t.user_id
   FROM tickets t
   WHERE t.title LIKE '%urgent%'
      OR t.title ILIKE '%billing issue%'
      OR t.status = 'escalated'
   ORDER BY t.created_at DESC`,

  // 15. Statistical aggregations
  `SELECT avg(amount) AS avg_amt,
          stddev(amount) AS stddev_amt,
          variance(amount) AS var_amt,
          min(amount) AS min_amt,
          max(amount) AS max_amt
   FROM orders
   WHERE status = 'completed'`,

  // 16. Multiple CTE pipeline
  `WITH eligible_users AS (
     SELECT id, name, email FROM users WHERE role = 'member'
   ),
   order_stats AS (
     SELECT user_id, sum(amount) AS total_spent FROM orders GROUP BY user_id
   )
   SELECT eu.id, eu.name, eu.email, coalesce(os.total_spent, 0) AS spent
   FROM eligible_users eu
   LEFT JOIN order_stats os ON eu.id = os.user_id
   ORDER BY spent DESC`,

  // 17. Null handling and coalesce filters
  `SELECT u.id, u.name,
          coalesce(u.email, 'no-email') AS safe_email,
          coalesce(t.title, 'no-ticket') AS ticket_title
   FROM users u
   LEFT JOIN tickets t ON u.id = t.user_id AND t.status = 'open'
   WHERE nullif(u.name, '') IS NOT NULL
   ORDER BY u.id ASC`,

  // 18. Complex ticket metrics join
  `SELECT t.status, count(*) AS ticket_count,
          count(DISTINCT t.user_id) AS unique_users
   FROM tickets t
   JOIN users u ON t.user_id = u.id
   WHERE u.tenant_id = 'corp_123'
   GROUP BY t.status
   ORDER BY ticket_count DESC`,

  // 19. Subquery with ANY and comparisons
  `SELECT o.id, o.amount, o.user_id
   FROM orders o
   WHERE o.amount > ANY (SELECT amount FROM orders WHERE status = 'refunded')
     AND o.status = 'completed'
   ORDER BY o.amount DESC`,

  // 20. Broad analytical query with sorting and slicing
  `SELECT u.id, u.name, u.email, u.created_at,
          count(o.id) AS total_orders,
          sum(o.amount) AS lifetime_value
   FROM users u
   LEFT JOIN orders o ON u.id = o.user_id AND o.status = 'completed'
   WHERE u.tenant_id = 'acme_corp'
   GROUP BY u.id, u.name, u.email, u.created_at
   HAVING count(o.id) > 0
   ORDER BY lifetime_value DESC, u.created_at ASC`,
];

export async function runSafetyBenchmark(): Promise<{
  p50: number;
  p95: number;
  p99: number;
  iterations: number;
}> {
  await warmParser();

  // Warmup 50 iterations
  for (let i = 0; i < 50; i++) {
    const q = REPRESENTATIVE_QUERIES[i % REPRESENTATIVE_QUERIES.length]!;
    const { tree } = await parseSql(q);
    classify(tree);
    checkRelations(tree, corpusPolicyIndex);
    checkColumns(tree, corpusPolicyIndex);
  }

  // 1,000 iterations over 20 representative queries
  const durations: number[] = [];
  const count = 1000;
  for (let i = 0; i < count; i++) {
    const q = REPRESENTATIVE_QUERIES[i % REPRESENTATIVE_QUERIES.length]!;
    const t0 = performance.now();
    const { tree } = await parseSql(q);
    classify(tree);
    checkRelations(tree, corpusPolicyIndex);
    checkColumns(tree, corpusPolicyIndex);
    durations.push(performance.now() - t0);
  }

  durations.sort((a, b) => a - b);
  const p50 = durations[Math.floor(count * 0.50)]!;
  const p95 = durations[Math.floor(count * 0.95)]!;
  const p99 = durations[Math.floor(count * 0.99)]!;

  return { p50, p95, p99, iterations: count };
}

describe('Safety Pipeline Benchmark (NFR-PERF-02)', () => {
  it('parse + classify + policy stays under 3 ms p95 for 1 KB queries', async () => {
    const { p50, p95, p99, iterations } = await runSafetyBenchmark();

    console.log(`\n======================================================`);
    console.log(` Safety Pipeline Benchmark Results (${iterations} iterations)`);
    console.log(`------------------------------------------------------`);
    console.log(`  p50: ${p50.toFixed(3)} ms`);
    console.log(`  p95: ${p95.toFixed(3)} ms`);
    console.log(`  p99: ${p99.toFixed(3)} ms`);
    console.log(`======================================================\n`);

    if (process.env.SKIP_PERF_ASSERTION !== 'true') {
      expect(p95).toBeLessThan(3.0);
    }
  }, 30000);
});
