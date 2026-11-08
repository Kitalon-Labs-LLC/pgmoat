// Report-only runner for the held-out cases. See README.md.
// It records every result and never fails on a miss: this set is a measurement, not a regression suite.
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { runSafety } from '../../src/safety/pipeline.js';
import { corpusPolicyIndex } from '../corpus/fixture-schema.js';

interface HeldOutCase {
  id: string;
  category: string;
  sql: string;
  mode?: 'query' | 'explain';
  expect: 'refused' | 'allowed';
  note?: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const cases = parseYaml(
  readFileSync(join(here, 'cases.yaml'), 'utf8'),
) as HeldOutCase[];

it('runs every held-out case once and records the result', async () => {
  const rows = [];
  for (const c of cases) {
    const res = await runSafety(c.sql, {
      policyIndex: corpusPolicyIndex,
      mode: c.mode ?? 'query',
      budgets: { max_rows: 200, max_sql_chars: 65_536 },
      checkColumnsOptions: { visibleColumns: corpusPolicyIndex.visibleColumns },
    });
    const decision = res.allowed ? 'allowed' : 'refused';
    rows.push({
      id: c.id,
      category: c.category,
      expect: c.expect,
      decision,
      code: res.allowed ? null : res.code,
      correct: decision === c.expect,
      sql: c.sql,
    });
  }
  writeFileSync(
    join(here, 'results.json'),
    `${JSON.stringify(rows, null, 2)}\n`,
  );

  const ok = rows.filter((r) => r.correct).length;
  const unsafe = rows.filter((r) => r.expect === 'refused');
  const legit = rows.filter((r) => r.expect === 'allowed');
  const lines = [
    `Held-out: ${ok} / ${rows.length} correct`,
    `  unsafe refused: ${unsafe.filter((r) => r.correct).length} / ${unsafe.length}`,
    `  legitimate allowed: ${legit.filter((r) => r.correct).length} / ${legit.length}`,
    ...rows
      .filter((r) => !r.correct)
      .map(
        (r) =>
          `  MISS ${r.id}: expected ${r.expect}, got ${r.decision}${r.code ? ` (${r.code})` : ''}`,
      ),
  ];
  console.log(lines.join('\n'));
});
