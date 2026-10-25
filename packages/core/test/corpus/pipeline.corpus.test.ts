import { describe, it, expect, beforeAll } from 'vitest';
import { loadAllCases, runCase } from './runner.js';
import type { CorpusCase } from './schema.js';

describe('Pipeline Corpus Runner (P2.10)', () => {
  const cases: CorpusCase[] = loadAllCases();

  beforeAll(() => {
    const counts: Record<string, number> = {};
    for (const c of cases) {
      counts[c.group] = (counts[c.group] ?? 0) + 1;
    }
    console.log('\n--- Corpus Cases Summary ---');
    for (const [grp, count] of Object.entries(counts)) {
      console.log(`  Group [${grp}]: ${count} cases`);
    }
    console.log(`  Total: ${cases.length} cases\n----------------------------\n`);
  });

  it.each(cases)('$id ($group): $sql', async (testCase) => {
    const res = await runCase(testCase);

    if (testCase.expect.allowed) {
      expect(res.allowed).toBe(true);
      if (!res.allowed) return;
      expect(res.sql).toBeDefined();
      expect(res.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    } else if (testCase.expect.refused) {
      expect(res.allowed).toBe(false);
      if (res.allowed) return;
      expect(res.code).toBe(testCase.expect.refused);
    }
  });
});
