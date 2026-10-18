import { describe, it, expect } from 'vitest';
import { loadAllCaseFiles } from './runner.js';

describe('Corpus Lint (P2.10)', () => {
  const caseFiles = loadAllCaseFiles();
  const allCases = caseFiles.flatMap((cf) => cf.cases);

  it('enforces unique IDs across all corpus cases', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const c of allCases) {
      if (seen.has(c.id)) {
        duplicates.push(c.id);
      }
      seen.add(c.id);
    }

    expect(duplicates).toEqual([]);
  });

  it('enforces that case IDs match format <group>-<number>', () => {
    for (const c of allCases) {
      // eslint-disable-next-line security/detect-non-literal-regexp -- group is validated enum
      const regex = new RegExp(`^${c.group}-\\d{3,}$`);
      expect(c.id).toMatch(regex);
    }
  });

  it('enforces that group matches the file basename', () => {
    for (const { filename, cases } of caseFiles) {
      const base = filename.replace(/\.ya?ml$/, '');
      for (const c of cases) {
        expect(c.group).toBe(base);
      }
    }
  });

  it('enforces that every refused case has a note explaining the attack', () => {
    const missingNotes: string[] = [];

    for (const c of allCases) {
      if (c.expect.refused) {
        if (!c.note || c.note.trim().length === 0) {
          missingNotes.push(c.id);
        }
      }
    }

    expect(missingNotes).toEqual([]);
  });

  it('enforces no duplicate SQL within a group', () => {
    const groupSqlMap = new Map<string, Set<string>>();
    const duplicates: string[] = [];

    for (const c of allCases) {
      const normalizedSql =
        c.sql.length === 0
          ? '<empty>'
          : c.sql.trim().length === 0
            ? `<whitespace:${c.sql}>`
            : c.sql.trim().replace(/\s+/g, ' ');
      if (!groupSqlMap.has(c.group)) {
        groupSqlMap.set(c.group, new Set());
      }
      const set = groupSqlMap.get(c.group)!;
      if (set.has(normalizedSql)) {
        duplicates.push(`${c.group}: ${c.id} (${normalizedSql})`);
      }
      set.add(normalizedSql);
    }

    expect(duplicates).toEqual([]);
  });
});
