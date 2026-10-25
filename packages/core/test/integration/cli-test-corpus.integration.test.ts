import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import pg from 'pg';
import {
  startPostgres,
  connectionUrl,
  stopPostgres,
} from './harness/postgres.js';
import { testCorpusCommand } from '../../../cli/src/commands/test-corpus.js';

describe('CLI test-corpus command integration (P8.6)', () => {
  let adminClient: pg.Client;

  beforeAll(async () => {
    await startPostgres();
    adminClient = new pg.Client({ connectionString: connectionUrl('postgres') });
    await adminClient.connect();
  }, 60000);

  afterAll(async () => {
    await adminClient?.end().catch(() => {});
    await stopPostgres();
  });

  it('runs corpus group against scratch schema and drops schema on completion', async () => {
    const adminUrl = connectionUrl('postgres');

    let stdout = '';
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((str) => {
      stdout += str;
      return true;
    });

    try {
      await testCorpusCommand({ url: adminUrl, group: 'locking', force: true });
      expect(stdout).toContain('Seeding schema pgmoat_corpus_');
      expect(stdout).toContain('Running 9 cases against Postgres');
      expect(stdout).toContain('locking       9/9    ok');
      expect(stdout).toContain('9 passed, 0 failed.  Dropped schema pgmoat_corpus_');

      // Verify the schema was truly dropped from Postgres
      const schemaMatch = stdout.match(/pgmoat_corpus_[a-z0-9]+/);
      expect(schemaMatch).not.toBeNull();
      const schemaName = schemaMatch![0];

      const res = await adminClient.query(
        'SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1',
        [schemaName],
      );
      expect(res.rows.length).toBe(0);
    } finally {
      writeSpy.mockRestore();
    }
  });

  it('refuses to run when target database has more than 10 tables without --force', async () => {
    const adminUrl = connectionUrl('postgres');

    // Create 12 temporary tables in a scratch schema to trigger table count > 10
    const setupClient = new pg.Client({ connectionString: adminUrl });
    await setupClient.connect();
    try {
      for (let i = 1; i <= 12; i++) {
        await setupClient.query(`CREATE TABLE IF NOT EXISTS temp_check_${i} (id int)`);
      }
    } finally {
      await setupClient.end().catch(() => {});
    }

    let stdout = '';
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((str) => {
      stdout += str;
      return true;
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit called with code ${code}`);
    });

    try {
      await expect(
        testCorpusCommand({ url: adminUrl, group: 'locking', force: false }),
      ).rejects.toThrow('process.exit called with code 1');

      expect(stdout).toContain('test-corpus refuses to run');
      expect(stdout).toContain('does not look disposable');
      expect(stdout).toContain('pass --force if you are sure');
    } finally {
      writeSpy.mockRestore();
      exitSpy.mockRestore();

      // Clean up the 12 temp tables
      const cleanClient = new pg.Client({ connectionString: adminUrl });
      await cleanClient.connect();
      try {
        for (let i = 1; i <= 12; i++) {
          await cleanClient.query(`DROP TABLE IF EXISTS temp_check_${i}`);
        }
      } finally {
        await cleanClient.end().catch(() => {});
      }
    }
  });
});
