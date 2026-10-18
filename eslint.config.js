import tseslint from 'typescript-eslint';
import securityPlugin from 'eslint-plugin-security';
import noSqlBuildingRule from './tools/eslint-rules/no-sql-string-building.js';

const pgmoatPlugin = {
  rules: {
    'no-sql-string-building': noSqlBuildingRule,
  },
};

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/*.log',
      'spec/**',
      'pnpm-lock.yaml',
    ],
  },
  ...tseslint.configs.recommended,
  securityPlugin.configs.recommended,
  {
    plugins: {
      pgmoat: pgmoatPlugin,
    },
    rules: {
      'pgmoat/no-sql-string-building': 'error',
    },
  },
  {
    files: ['**/test/**', 'tools/**', 'packages/core/src/config/**'],
    rules: {
      'pgmoat/no-sql-string-building': 'off',
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
  {
    files: ['packages/core/src/safety/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
];
