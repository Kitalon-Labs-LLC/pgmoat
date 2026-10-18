import type pg from 'pg';
import type { DoctorFinding } from '../types.js';
import type { PgmoatConfigT } from '../config/schema.js';
import { acquire, type Pools } from './pool.js';
import type { IntrospectionResult } from './introspect.js';

export interface HiddenColumnEntry {
  schema: string;
  table: string;
  column: string;
}

/**
 * Quotes an identifier with double quotes and doubled internal quotes.
 * Used for formatting human-facing SQL fix suggestions.
 */
export function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

/**
 * Quotes a schema-qualified identifier.
 */
export function quoteQualified(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

/**
 * Computes hidden columns from config annotations and raw introspection.
 */
export function computeHiddenColumns(
  config: PgmoatConfigT,
  introspection: IntrospectionResult,
): HiddenColumnEntry[] {
  const hiddenCols: HiddenColumnEntry[] = [];
  for (const rel of introspection.relations) {
    const tableCfg =
      config.tables[rel.name] ??
      config.tables[`${rel.schema}.${rel.name}`];
    if (!tableCfg?.columns) continue;
    for (const [colName, colCfg] of Object.entries(tableCfg.columns)) {
      if (colCfg.hidden) {
        hiddenCols.push({
          schema: rel.schema,
          table: rel.name,
          column: colName,
        });
      }
    }
  }
  return hiddenCols;
}

function normalizeHiddenColumns(
  entries: (HiddenColumnEntry | string)[],
  introspection: IntrospectionResult,
): HiddenColumnEntry[] {
  return entries.map((entry) => {
    if (typeof entry !== 'string') {
      return entry;
    }
    const parts = entry.split('.');
    if (parts.length === 3) {
      return { schema: parts[0]!, table: parts[1]!, column: parts[2]! };
    }
    if (parts.length === 2) {
      const rel = introspection.relations.find((r) => r.name === parts[0]);
      const schema = rel?.schema ?? 'public';
      return { schema, table: parts[0]!, column: parts[1]! };
    }
    return { schema: 'public', table: '', column: entry };
  });
}

function isPools(obj: unknown): obj is Pools {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'query' in obj &&
    typeof (obj as { query: unknown }).query === 'object' &&
    (obj as { query: unknown }).query !== null &&
    'control' in obj
  );
}

function isPool(obj: unknown): obj is pg.Pool {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    ('totalCount' in obj || 'idleCount' in obj) &&
    typeof (obj as pg.Pool).connect === 'function'
  );
}

/**
 * Runs doctor checks (PGM-701 to PGM-707) against the target database.
 */
export async function runDoctor(
  source: Pools | pg.Pool | pg.ClientBase,
  config: PgmoatConfigT,
  introspection: IntrospectionResult,
  hiddenColumns?: (HiddenColumnEntry | string)[],
): Promise<DoctorFinding[]> {
  const findings: DoctorFinding[] = [];

  let client: pg.ClientBase;
  let shouldRelease = false;
  if (isPools(source)) {
    client = await acquire(source.query, 10000);
    shouldRelease = true;
  } else if (isPool(source)) {
    client = await acquire(source, 10000);
    shouldRelease = true;
  } else {
    client = source as pg.ClientBase;
  }

  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SELECT set_config('statement_timeout', '10000', true)");

    // Query current user role attributes
    const roleRes = await client.query<{
      curr_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT
        current_user AS curr_user,
        rolsuper,
        rolbypassrls
      FROM pg_roles
      WHERE rolname = current_user`,
    );

    const currentUser = roleRes.rows[0]?.curr_user ?? introspection.currentUser;
    const isSuperUser = roleRes.rows[0]?.rolsuper ?? false;
    const isBypassRls = roleRes.rows[0]?.rolbypassrls ?? false;

    // 1. PGM-701: Superuser check
    if (isSuperUser) {
      findings.push({
        code: 'PGM-701',
        severity: 'fail',
        subject: `role ${currentUser}`,
        message: `Role "${currentUser}" is a superuser`,
        fix: `Create a dedicated NOSUPERUSER role: CREATE ROLE pgmoat_reader LOGIN NOSUPERUSER NOBYPASSRLS; or ALTER ROLE ${quoteIdent(currentUser)} NOSUPERUSER;`,
      });
    }

    // 2. PGM-702: BYPASSRLS check
    if (isBypassRls) {
      const hasRlsConfig =
        config.rls.required ||
        config.rls.protected_tables.length > 0 ||
        Object.keys(config.rls.session_variables).length > 0;
      findings.push({
        code: 'PGM-702',
        severity: hasRlsConfig ? 'fail' : 'info',
        subject: `role ${currentUser}`,
        message: `Role "${currentUser}" has BYPASSRLS privilege`,
        fix: `ALTER ROLE ${quoteIdent(currentUser)} NOBYPASSRLS;`,
      });
    }

    // 3. PGM-703: Role owns protected table without FORCE ROW LEVEL SECURITY
    // 4. PGM-704: Protected table has RLS disabled
    for (const tableName of config.rls.protected_tables) {
      const rel = introspection.relations.find(
        (r) =>
          r.name === tableName ||
          `${r.schema}.${r.name}` === tableName,
      );
      if (!rel) continue;

      if (!rel.relrowsecurity) {
        findings.push({
          code: 'PGM-704',
          severity: 'fail',
          subject: `${rel.schema}.${rel.name}`,
          message: `Row-level security disabled on "${rel.schema}.${rel.name}"`,
          // eslint-disable-next-line pgmoat/no-sql-string-building -- human-facing suggestion, never executed by pgmoat
          fix: `ALTER TABLE ${quoteQualified(rel.schema, rel.name)} ENABLE ROW LEVEL SECURITY;`,
        });
      }

      if (rel.owner === currentUser && !rel.relforcerowsecurity) {
        findings.push({
          code: 'PGM-703',
          severity: 'fail',
          subject: `${rel.schema}.${rel.name}`,
          message: `Role "${currentUser}" owns protected relation "${rel.schema}.${rel.name}" without FORCE ROW LEVEL SECURITY`,
          // eslint-disable-next-line pgmoat/no-sql-string-building -- human-facing suggestion, never executed by pgmoat
          fix: `ALTER TABLE ${quoteQualified(rel.schema, rel.name)} FORCE ROW LEVEL SECURITY;`,
        });
      }
    }

    // 5. PGM-705: Can read hidden column
    const resolvedHiddenCols = normalizeHiddenColumns(
      hiddenColumns ?? computeHiddenColumns(config, introspection),
      introspection,
    );

    if (resolvedHiddenCols.length > 500) {
      findings.push({
        code: 'PGM-705',
        severity: 'info',
        subject: `${resolvedHiddenCols.length} hidden columns`,
        message: `Skipped column privilege checks: ${resolvedHiddenCols.length} hidden columns exceeds cap of 500`,
        fix: 'Run doctor with a smaller schema or verify column privileges manually',
      });
    } else {
      for (const col of resolvedHiddenCols) {
        const privRes = await client.query<{ can_select: boolean }>(
          `SELECT has_column_privilege(current_user, $1, $2, 'SELECT') AS can_select`,
          [`${quoteQualified(col.schema, col.table)}`, col.column],
        );
        if (privRes.rows[0]?.can_select) {
          findings.push({
            code: 'PGM-705',
            severity: 'warn',
            subject: `${col.schema}.${col.table}.${col.column}`,
            message: `Role "${currentUser}" has read access to hidden column "${col.schema}.${col.table}.${col.column}"`,
            // eslint-disable-next-line pgmoat/no-sql-string-building -- human-facing suggestion, never executed by pgmoat
            fix: `REVOKE SELECT (${quoteIdent(col.column)}) ON ${quoteQualified(col.schema, col.table)} FROM ${quoteIdent(currentUser)};`,
          });
        }
      }
    }

    // 6. PGM-706: Write privileges in read-only mode
    if (config.mode === 'read-only') {
      for (const rel of introspection.relations) {
        const isHiddenTable =
          config.tables[rel.name]?.hidden === true ||
          config.tables[`${rel.schema}.${rel.name}`]?.hidden === true;
        if (isHiddenTable) continue;
        if (!['r', 'p', 'v', 'f'].includes(rel.kind)) continue;

        const privRes = await client.query<{ has_write: boolean }>(
          `SELECT has_table_privilege(current_user, $1, 'INSERT,UPDATE,DELETE,TRUNCATE') AS has_write`,
          [`${quoteQualified(rel.schema, rel.name)}`],
        );
        if (privRes.rows[0]?.has_write) {
          findings.push({
            code: 'PGM-706',
            severity: 'warn',
            subject: `${rel.schema}.${rel.name}`,
            message: `Role "${currentUser}" has write privileges on "${rel.schema}.${rel.name}" in read-only mode`,
            // eslint-disable-next-line pgmoat/no-sql-string-building -- human-facing suggestion, never executed by pgmoat
            fix: `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ${quoteQualified(rel.schema, rel.name)} FROM ${quoteIdent(currentUser)};`,
          });
        }
      }
    }

    // 7. PGM-707: Server version outside 15 to 18
    if (
      introspection.serverVersionNum < 150000 ||
      introspection.serverVersionNum >= 190000
    ) {
      const major = Math.floor(introspection.serverVersionNum / 10000);
      findings.push({
        code: 'PGM-707',
        severity: 'warn',
        subject: `Postgres server ${major}`,
        message: `Postgres server version ${major} (${introspection.serverVersionNum}) is outside the supported range (15 to 18)`,
        fix: 'Upgrade Postgres to version 15, 16, 17, or 18',
      });
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (shouldRelease) {
      (client as pg.PoolClient).release();
    }
  }

  return findings;
}
