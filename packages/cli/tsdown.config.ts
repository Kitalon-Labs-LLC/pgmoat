import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    bin: 'src/bin.ts',
  },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  outExtensions: () => ({ js: '.mjs' }),
  clean: true,
  dts: false,
  sourcemap: false,
  outputOptions: {
    codeSplitting: false,
  },
  deps: {
    neverBundle: ['libpg-query', 'pg', 'pg-cursor'],
    alwaysBundle: [/.*/],
    onlyBundle: false,
  },
});

