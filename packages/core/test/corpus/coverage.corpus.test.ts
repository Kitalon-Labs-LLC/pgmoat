import { describe, it, expect } from 'vitest';
import { loadAllCases } from './runner.js';
import type { CorpusGroup } from './schema.js';

describe('Corpus Coverage & Minimums (FR-CORPUS-01, FR-CORPUS-04, P12.1)', () => {
  const allCases = loadAllCases();

  const GROUP_MINIMUMS: Record<CorpusGroup, number> = {
    allowed: 80,
    statements: 40,
    stacking: 15,
    cte: 15,
    functions: 40,
    'sql-exec': 15,
    locking: 8,
    explain: 8,
    policy: 60,
    budgets: 10,
    edge: 15,
  };

  const SPEC_BYPASS_CLASSES = [
    'Statement stacking',
    'Writing CTE',
    'Side-effect functions',
    'SQL-executing functions',
    'File and network functions',
    'Hidden data via shape tricks',
    'Catalog enumeration',
    'Session state abuse',
    'EXPLAIN ANALYZE write',
    'RLS bypass',
    'Tenant spoofing',
    'Prompt injection through data',
  ] as const;

  it('contains at least 300 total test cases across all groups', () => {
    expect(allCases.length).toBeGreaterThanOrEqual(300);
  });

  it('meets or exceeds the minimum case count for every corpus group (spec/02 F18)', () => {
    const countsByGroup = new Map<CorpusGroup, number>();
    for (const c of allCases) {
      countsByGroup.set(c.group, (countsByGroup.get(c.group) ?? 0) + 1);
    }

    for (const [group, min] of Object.entries(GROUP_MINIMUMS)) {
      const actual = countsByGroup.get(group as CorpusGroup) ?? 0;
      expect(
        actual,
        `Group "${group}" has ${actual} cases, expected at least ${min}`,
      ).toBeGreaterThanOrEqual(min);
    }
  });

  it('covers every bypass class in spec/01 section 14.1 with at least one case (FR-CORPUS-04)', () => {
    const casesByBypassClass = new Map<string, string[]>();
    for (const c of allCases) {
      if (c.bypass_class) {
        const existing = casesByBypassClass.get(c.bypass_class) ?? [];
        existing.push(c.id);
        casesByBypassClass.set(c.bypass_class, existing);
      }
    }

    for (const bypassClass of SPEC_BYPASS_CLASSES) {
      const matchingCases = casesByBypassClass.get(bypassClass);
      expect(
        matchingCases && matchingCases.length > 0,
        `Expected at least one corpus case mapped to bypass class "${bypassClass}"`,
      ).toBe(true);
    }
  });
});
