import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { renderYaml, AUTO_HIDE_REGEX, type RenderRelationInput } from '../src/init/render-yaml.js';
import { mergeYaml } from '../src/init/merge.js';
import { initCommand } from '../src/commands/init.js';
import { loadConfig } from '@pgmoat/core';

describe('CLI init wizard (P8.4)', () => {
  it('auto-hide regex matches sensitive column patterns', () => {
    expect(AUTO_HIDE_REGEX.test('password_hash')).toBe(true);
    expect(AUTO_HIDE_REGEX.test('passwd')).toBe(true);
    expect(AUTO_HIDE_REGEX.test('api_key')).toBe(true);
    expect(AUTO_HIDE_REGEX.test('token')).toBe(true);
    expect(AUTO_HIDE_REGEX.test('mfa_secret')).toBe(true);
    expect(AUTO_HIDE_REGEX.test('salt')).toBe(true);
    expect(AUTO_HIDE_REGEX.test('ssn')).toBe(true);
    expect(AUTO_HIDE_REGEX.test('credit_card')).toBe(true);

    expect(AUTO_HIDE_REGEX.test('username')).toBe(false);
    expect(AUTO_HIDE_REGEX.test('email')).toBe(false);
    expect(AUTO_HIDE_REGEX.test('created_at')).toBe(false);
  });

  it('renders YAML accepted by loadConfig with auto-hidden columns', () => {
    const relations: RenderRelationInput[] = [
      {
        name: 'users',
        schema: 'public',
        comment: 'User accounts table',
        columns: [
          { name: 'id', comment: 'Identifier' },
          { name: 'email', comment: 'User email' },
          { name: 'password_hash', hidden: true },
          { name: 'mfa_secret', hidden: true },
          { name: 'created_at', comment: 'Created timestamp' },
        ],
      },
    ];

    const yamlStr = renderYaml({
      serverName: 'test-server',
      description: 'Test database description',
      connectionUrl: 'postgresql://localhost:5432/testdb',
      schemas: ['public'],
      relations,
    });

    expect(yamlStr).toContain('# yaml-language-server: $schema=https://pgmoat.dev/schema/pgmoat.v1.json');
    expect(yamlStr).toContain('password_hash: { hidden: true }');
    expect(yamlStr).toContain('mfa_secret:    { hidden: true }');
    expect(yamlStr).toContain('id:            { description: "Identifier" }');

    // Test writing to disk and validating with loadConfig
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgmoat-init-render-'));
    const tmpFile = path.join(tmpDir, 'pgmoat.yaml');
    try {
      fs.writeFileSync(tmpFile, yamlStr, 'utf8');
      const loaded = loadConfig({ path: tmpFile });
      expect(loaded.kind).toBe('file');
      if (loaded.kind === 'file') {
        expect(loaded.config.server.name).toBe('test-server');
        expect(loaded.config.tables.users.columns?.password_hash.hidden).toBe(true);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('merge preserves edited descriptions and comments, adds new tables/columns, and marks stale', () => {
    const existingYaml = `# yaml-language-server: $schema=https://pgmoat.dev/schema/pgmoat.v1.json
version: 1
server:
  name: existing-server
  description: "Human edited server description"

tables:
  users:
    description: "Custom human description"
    columns:
      id: { description: "Primary key" }
      password_hash: { hidden: true }
  deleted_table:
    description: "Old table"
`;

    const discoveredRelations: RenderRelationInput[] = [
      {
        name: 'users',
        schema: 'public',
        columns: [
          { name: 'id' },
          { name: 'password_hash' },
          { name: 'new_column', comment: 'Added recently' },
        ],
      },
      {
        name: 'orders',
        schema: 'public',
        comment: 'Orders relation',
        columns: [{ name: 'id' }, { name: 'amount' }],
      },
    ];

    const merged = mergeYaml(existingYaml, discoveredRelations, {
      dateStr: '2026-10-19',
    });

    expect(merged.stats.keptDescriptions).toBeGreaterThan(0);
    expect(merged.stats.addedTables).toBe(1); // orders
    expect(merged.stats.addedColumns).toBe(1); // new_column
    expect(merged.stats.staleTables).toBe(1); // deleted_table

    expect(merged.yaml).toContain('Custom human description');
    expect(merged.yaml).toContain('new_column');
    expect(merged.yaml).toContain('orders');
    expect(merged.yaml).toContain('STALE: not found in database on 2026-10-19');
  });

  it('aborts when pgmoat.yaml exists without --merge and --yes is given', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgmoat-init-abort-'));
    const tmpFile = path.join(tmpDir, 'pgmoat.yaml');
    fs.writeFileSync(tmpFile, 'version: 1\n', 'utf8');

    let exitCode: number | undefined;
    const origExit = process.exit;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`process.exit called with ${code}`);
    }) as unknown as typeof process.exit;

    try {
      await expect(
        initCommand({
          out: tmpDir,
          yes: true,
          merge: false,
        }),
      ).rejects.toThrow('process.exit called with 1');
      expect(exitCode).toBe(1);
    } finally {
      process.exit = origExit;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

