import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../../src/config/load.js';
import { isPgmoatError } from '../../../src/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(
  __dirname,
  '../../fixtures/configs',
);

describe('config fixture library', () => {
  const files = fs
    .readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort();

  it('contains at least 40 fixtures', () => {
    expect(files.length).toBeGreaterThanOrEqual(40);
  });

  for (const file of files) {
    const fullPath = path.join(fixturesDir, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const firstLine = content.split('\n')[0]?.trim() ?? '';
    const match = firstLine.match(/^#\s*expect:\s*(.+)$/i);

    if (!match) {
      throw new Error(
        `Fixture ${file} must start with a comment "# expect: valid" or "# expect: PGM-xxx"`,
      );
    }

    const rawExpect = match[1]!.trim();
    const isStrict = file.includes('strict');

    it(`fixture ${file} matches expectation: ${rawExpect}`, () => {
      if (rawExpect === 'valid') {
        const res = loadConfig({
          path: fullPath,
          strict: isStrict,
          env: {
            PG_USER: 'testuser',
          },
        });
        expect(res.kind).toBe('file');
      } else {
        const expectedCodes = rawExpect.split(',').map((s) => s.trim());
        try {
          loadConfig({
            path: fullPath,
            strict: isStrict,
            env: {},
          });
          expect.fail(`Fixture ${file} was expected to fail with ${rawExpect}`);
        } catch (err) {
          expect(isPgmoatError(err)).toBe(true);
          if (isPgmoatError(err)) {
            const matchesExpected = expectedCodes.some(
              (code) =>
                err.code === code || err.message.includes(code),
            );
            expect(
              matchesExpected,
              `Fixture ${file} failed with error ${err.code} / "${err.message}", but expected ${rawExpect}`,
            ).toBe(true);
          }
        }
      }
    });
  }
});
