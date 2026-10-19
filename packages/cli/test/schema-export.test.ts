import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  formatRelationMarkdown,
  schemaExportCommand,
} from '../src/commands/schema-export.js';
import { resetOutputConfig } from '../src/output.js';

describe('CLI schema-export command (P8.6)', () => {
  let tmpDir: string;

  beforeEach(() => {
    resetOutputConfig();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgmoat-schema-export-test-'));
  });

  afterEach(() => {
    resetOutputConfig();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('formats relation markdown matching spec layout', () => {
    const rel = {
      qualifiedName: 'public.users',
      kind: 'table',
      description: 'Core application users table',
      rowEstimate: 1250,
      columns: [
        {
          name: 'id',
          type: 'uuid',
          notNull: true,
          description: 'Unique user identifier',
          sensitive: null,
          untrusted: false,
        },
        {
          name: 'email',
          type: 'text',
          notNull: true,
          description: 'User email address',
          sensitive: 'medium',
          untrusted: false,
        },
        {
          name: 'bio',
          type: 'text',
          notNull: false,
          description: 'User profile bio',
          sensitive: null,
          untrusted: true,
        },
      ],
      primaryKey: ['id'],
      uniqueKeys: [['email']],
      foreignKeys: [
        {
          name: 'fk_users_tenant',
          columns: ['tenant_id'],
          references: { relation: 'public.tenants', columns: ['id'] },
        },
      ],
      referencedBy: [
        {
          relation: 'public.orders',
          columns: ['user_id'],
        },
      ],
      hiddenColumnCount: 2,
    };

    const md = formatRelationMarkdown(rel, true);
    expect(md).toContain('## public.users (table) (~1,250 rows)');
    expect(md).toContain('Core application users table');
    expect(md).toContain('| Column | Type | Nullable | Attributes | Description |');
    expect(md).toContain('| id | uuid | NO | PK | Unique user identifier |');
    expect(md).toContain('| email | text | NO | UNIQUE, sensitive:medium | User email address |');
    expect(md).toContain('| bio | text | YES | untrusted | User profile bio |');
    expect(md).toContain('- **Foreign Keys:** tenant_id -> public.tenants');
    expect(md).toContain('- **Referenced By:** public.orders(user_id)');
    expect(md).toContain('- **Hidden Columns:** 2 columns hidden');
  });

  it('exits with error when config file does not exist', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit called with code ${code}`);
    });

    try {
      await expect(
        schemaExportCommand({ config: path.join(tmpDir, 'nonexistent.yaml') }),
      ).rejects.toThrow('process.exit called with code 3');
    } finally {
      exitSpy.mockRestore();
    }
  });
});
