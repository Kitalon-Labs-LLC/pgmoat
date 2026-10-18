import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: [
            'packages/core/test/unit/**/*.test.ts',
            'packages/cli/test/**/*.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'corpus',
          include: ['packages/core/test/corpus/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'property',
          include: ['packages/core/test/property/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'bench',
          include: ['packages/core/bench/**/*.bench.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['packages/core/test/integration/**/*.test.ts'],
          testTimeout: 60000,
          fileParallelism: false,
        },
      },
    ],
  },
});
