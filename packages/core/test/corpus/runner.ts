import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { CorpusFileSchema, type CorpusCase } from './schema.js';
import { runSafety, type PipelineSafetyResult } from '../../src/safety/pipeline.js';
import { corpusPolicyIndex } from './fixture-schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CASES_DIR = join(__dirname, 'cases');

export function loadAllCaseFiles(): { filename: string; cases: CorpusCase[] }[] {
  const files = readdirSync(CASES_DIR).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  return files.map((filename) => {
    const fullPath = join(CASES_DIR, filename);
    const content = readFileSync(fullPath, 'utf8');
    const parsed = parseYaml(content);
    const validated = CorpusFileSchema.parse(parsed);
    return { filename, cases: validated };
  });
}

export function loadAllCases(): CorpusCase[] {
  const caseFiles = loadAllCaseFiles();
  return caseFiles.flatMap((cf) => cf.cases);
}

export async function runCase(
  testCase: CorpusCase,
): Promise<PipelineSafetyResult> {
  const mode = testCase.group === 'explain' ? 'explain' : 'query';

  return runSafety(testCase.sql, {
    policyIndex: corpusPolicyIndex,
    mode,
    budgets: {
      max_rows: 200,
      max_sql_chars: 65_536,
    },
    checkColumnsOptions: {
      visibleColumns: corpusPolicyIndex.visibleColumns,
    },
  });
}
