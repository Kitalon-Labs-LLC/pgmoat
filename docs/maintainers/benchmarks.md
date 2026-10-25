# Performance Benchmarks and Regression Guard

This document specifies the benchmark methodology, non-functional performance requirements (NFRs), and reproduction steps for `pgmoat`.

## Targets and Performance Requirements

The test suite continuously guards five primary performance targets:

| Requirement ID | Description | Target Threshold | Measured Test Suite |
|---|---|---|---|
| **NFR-PERF-01** | Safety pipeline p95 latency on 1 KB SQL | `< 3.0 ms` | `packages/core/bench/query.bench.ts` |
| **NFR-PERF-02** | Safety pipeline p95 latency on 10 KB SQL | `< 10.0 ms` | `packages/core/bench/query.bench.ts` |
| **NFR-PERF-03** | Cold start to CLI response | `< 1.0 s` | `packages/core/bench/startup.bench.ts` |
| **NFR-PERF-04** | Streaming chunk dispatch delay | `< 5.0 ms` | `packages/core/bench/http.bench.ts` |
| **NFR-PERF-05** | HTTP round-trip transport overhead | `< 5.0 ms` | `packages/core/bench/http.bench.ts` |
| **NFR-PERF-06** | Audit pipeline enqueue p95 latency | `< 1.0 ms` | `packages/core/bench/audit.bench.ts` |

## Methodology

1. **Parser and Engine Warmup**: Because V8 and `libpg-query` perform just-in-time compilation and cache initialization on initial runs, all suites execute between 20 and 50 warm-up cycles before collecting latency samples.
2. **Serial Execution (`--fileParallelism=false`)**: Benchmarks are executed serially to prevent CPU core contention and cache thrashing across worker threads.
3. **High-Resolution Clock**: Durations are measured using `performance.now()`, sorting sample arrays to compute exact p50, p95, and p99 percentiles.
4. **Realistic Payloads**: The test queries reflect multi-join analytical queries with real-world filters, aggregations, window functions, and common table expressions.

## How to Run Locally

To run the complete benchmark suite:

```bash
# Ensure packages are built
pnpm build

# Run all benchmarks serially
./node_modules/.bin/vitest run packages/core/bench/ --fileParallelism=false
```

To run a specific benchmark:

```bash
# Query safety pipeline latency
./node_modules/.bin/vitest run packages/core/bench/query.bench.ts

# Cold startup latency
./node_modules/.bin/vitest run packages/core/bench/startup.bench.ts

# HTTP transport and streaming dispatch
./node_modules/.bin/vitest run packages/core/bench/http.bench.ts
```

## CI Integration

The benchmark suite runs automatically on every pull request that touches core packages via `.github/workflows/bench.yml`. If any metric degrades beyond its target threshold, the workflow fails, preventing performance regressions from landing in release branches.

