import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type TestRole =
  | 'postgres'
  | 'pgmoat_reader'
  | 'pgmoat_owner_like'
  | 'pgmoat_bypass'
  | 'pgmoat_writer'
  | 'pgmoat_audit';

const ROLE_PASSWORDS: Record<TestRole, string> = {
  postgres: 'postgres',
  pgmoat_reader: 'pgmoat_reader_pw',
  pgmoat_owner_like: 'pgmoat_owner_like_pw',
  pgmoat_bypass: 'pgmoat_bypass_pw',
  pgmoat_writer: 'pgmoat_writer_pw',
  pgmoat_audit: 'pgmoat_audit_pw',
};

let activeContainer: StartedPostgreSqlContainer | null = null;
let activePgVersion: string | null = null;
let activeStartingPromise: Promise<StartedPostgreSqlContainer> | null = null;

const seedSql = readFileSync(join(__dirname, 'seed.sql'), 'utf-8');
const rolesSql = readFileSync(join(__dirname, 'roles.sql'), 'utf-8');
const rlsSql = readFileSync(join(__dirname, 'rls.sql'), 'utf-8');

/**
 * Starts a PostgreSQL container (if not already running for the target PG version)
 * and initializes seed data, roles, and RLS policies.
 */
export async function startPostgres(
  versionOverride?: string,
): Promise<StartedPostgreSqlContainer> {
  const targetVersion =
    versionOverride ?? process.env.PGMOAT_TEST_PG ?? '17';

  if (activeContainer && activePgVersion === targetVersion) {
    return activeContainer;
  }

  if (activeStartingPromise && activePgVersion === targetVersion) {
    return activeStartingPromise;
  }

  activeStartingPromise = (async () => {
    if (activeContainer) {
      await activeContainer.stop();
      activeContainer = null;
      activePgVersion = null;
    }

    const container = await new PostgreSqlContainer(`postgres:${targetVersion}`)
      .withDatabase('testdb')
      .withUsername('postgres')
      .withPassword('postgres')
      .start();

    activeContainer = container;
    activePgVersion = targetVersion;

    // Execute initialization scripts as superuser
    const superuserUrl = container.getConnectionUri();
    const client = new pg.Client({ connectionString: superuserUrl });
    await client.connect();

    try {
      await client.query(seedSql);
      await client.query(rolesSql);
      await client.query(rlsSql);
    } finally {
      await client.end();
    }

    return container;
  })();

  try {
    return await activeStartingPromise;
  } finally {
    activeStartingPromise = null;
  }
}

/**
 * Returns connection URL for a specific role against the running container.
 */
export function connectionUrl(role: TestRole = 'postgres'): string {
  if (!activeContainer) {
    throw new Error(
      'PostgreSQL testcontainer is not running. Call startPostgres() first.',
    );
  }

  const uri = activeContainer.getConnectionUri();
  const url = new URL(uri);
  url.username = role;
  url.password = ROLE_PASSWORDS[role] ?? role;
  return url.toString();
}

/**
 * Resets all seeded tables back to initial test data.
 */
export async function resetData(): Promise<void> {
  if (!activeContainer) {
    throw new Error(
      'PostgreSQL testcontainer is not running. Call startPostgres() first.',
    );
  }

  const superuserUrl = connectionUrl('postgres');
  const client = new pg.Client({ connectionString: superuserUrl });
  await client.connect();

  try {
    await client.query(seedSql);
    // Ensure ownership and permissions remain intact
    await client.query(rolesSql);
    await client.query(rlsSql);
  } finally {
    await client.end();
  }
}

/**
 * Stops the active container if running.
 */
export async function stopPostgres(): Promise<void> {
  if (activeContainer) {
    await activeContainer.stop();
    activeContainer = null;
    activePgVersion = null;
  }
}
