import type pg from 'pg';
import type { RelationKind } from '../types.js';
import { acquire, type Pools } from './pool.js';

export interface RawColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  default: string | null;
  ordinal: number;
  description: string | null;
}

export interface RawForeignKeyInfo {
  name: string;
  columns: string[];
  references: {
    schema: string;
    relation: string;
    columns: string[];
  };
  onDelete: 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT';
}

export interface RawIndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
  definition: string;
}

export interface RawRelationInfo {
  oid: number;
  schema: string;
  name: string;
  kind: 'r' | 'p' | 'v' | 'm' | 'f';
  kindName: RelationKind;
  description: string | null;
  rowEstimate: number;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
  owner: string;
  columns: RawColumnInfo[];
  primaryKey: string[] | null;
  uniqueKeys: string[][];
  foreignKeys: RawForeignKeyInfo[];
  indexes: RawIndexInfo[];
}

export interface IntrospectionResult {
  serverVersionNum: number;
  currentUser: string;
  relations: RawRelationInfo[];
}

function mapRelationKind(kind: string): RelationKind {
  switch (kind) {
    case 'r':
      return 'table';
    case 'p':
      return 'partitioned_table';
    case 'v':
      return 'view';
    case 'm':
      return 'materialized_view';
    case 'f':
      return 'foreign_table';
    default:
      return 'table';
  }
}

function mapOnDelete(
  action: string,
): 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT' {
  switch (action) {
    case 'a':
      return 'NO ACTION';
    case 'r':
      return 'RESTRICT';
    case 'c':
      return 'CASCADE';
    case 'n':
      return 'SET NULL';
    case 'd':
      return 'SET DEFAULT';
    default:
      return 'NO ACTION';
  }
}

function parsePgArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === 'string') {
    const trimmed = val.replace(/^\{|\}$/g, '');
    if (!trimmed) return [];
    return trimmed.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
  }
  return [];
}

interface RawRelationRow {
  oid: number;
  schema: string;
  name: string;
  kind: 'r' | 'p' | 'v' | 'm' | 'f';
  description: string | null;
  row_estimate: string | number;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
  owner: string;
}

interface RawColumnRow {
  rel_oid: number;
  name: string;
  type: string;
  not_null: boolean;
  default_expr: string | null;
  description: string | null;
  ordinal: number;
}

interface RawConstraintRow {
  rel_oid: number;
  name: string;
  type: 'p' | 'u' | 'f';
  on_delete_action: string | null;
  ref_schema: string | null;
  ref_table: string | null;
  columns: string[];
  ref_columns: string[] | null;
}

interface RawIndexRow {
  rel_oid: number;
  name: string;
  is_unique: boolean;
  is_primary: boolean;
  definition: string;
  columns: string[];
}

/**
 * Introspects raw catalog facts for exposed schemas inside a READ ONLY transaction with 10 s timeout.
 */
export async function introspect(
  source: pg.Pool | pg.ClientBase | Pools,
  schemas: string[],
): Promise<IntrospectionResult> {
  let client: pg.PoolClient | pg.ClientBase;
  let shouldRelease = false;

  if ('query' in source && typeof (source as Pools).end === 'function') {
    // Pools object
    client = await acquire((source as Pools).query, 10000);
    shouldRelease = true;
  } else if ('connect' in source && typeof (source as pg.Pool).connect === 'function') {
    // pg.Pool
    client = await acquire(source as pg.Pool, 10000);
    shouldRelease = true;
  } else {
    // Direct pg.ClientBase
    client = source as pg.ClientBase;
  }

  let broken = false;
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SELECT set_config('statement_timeout', '10000', true)");

    // 0. Version and Current User
    const metaRes = await client.query<{
      server_version_num: number;
      curr_user: string;
    }>(
      `SELECT
        current_setting('server_version_num')::int AS server_version_num,
        current_user AS curr_user`,
    );
    const serverVersionNum = metaRes.rows[0]?.server_version_num ?? 0;
    const currentUser = metaRes.rows[0]?.curr_user ?? '';

    // 1. Relations
    const relsRes = await client.query<RawRelationRow>(
      `SELECT
        c.oid,
        n.nspname AS schema,
        c.relname AS name,
        c.relkind AS kind,
        obj_description(c.oid, 'pg_class') AS description,
        c.reltuples::bigint AS row_estimate,
        c.relrowsecurity,
        c.relforcerowsecurity,
        pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1::text[])
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      ORDER BY n.nspname, c.relname`,
      [schemas],
    );

    // 2. Columns
    const colsRes = await client.query<RawColumnRow>(
      `SELECT
        a.attrelid AS rel_oid,
        a.attname AS name,
        format_type(a.atttypid, a.atttypmod) AS type,
        a.attnotnull AS not_null,
        pg_get_expr(d.adbin, d.adrelid) AS default_expr,
        col_description(a.attrelid, a.attnum) AS description,
        a.attnum AS ordinal
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = ANY($1::text[])
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY a.attrelid, a.attnum`,
      [schemas],
    );

    // 3. Constraints (PK, Unique, FK)
    const consRes = await client.query<RawConstraintRow>(
      `SELECT
        con.conrelid AS rel_oid,
        con.conname AS name,
        con.contype AS type,
        con.confdeltype AS on_delete_action,
        ref_n.nspname AS ref_schema,
        ref_c.relname AS ref_table,
        ARRAY(
          SELECT a.attname
          FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
          ORDER BY k.ord
        )::text[] AS columns,
        ARRAY(
          SELECT a.attname
          FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum
          ORDER BY k.ord
        )::text[] AS ref_columns
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_class ref_c ON ref_c.oid = con.confrelid
      LEFT JOIN pg_namespace ref_n ON ref_n.oid = ref_c.relnamespace
      WHERE n.nspname = ANY($1::text[])
        AND con.contype IN ('p', 'u', 'f')
      ORDER BY con.conrelid, con.conname`,
      [schemas],
    );

    // 4. Indexes
    const idxsRes = await client.query<RawIndexRow>(
      `SELECT
        i.indrelid AS rel_oid,
        c_idx.relname AS name,
        i.indisunique AS is_unique,
        i.indisprimary AS is_primary,
        pg_get_indexdef(i.indexrelid) AS definition,
        ARRAY(
          SELECT a.attname
          FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
          LEFT JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
          WHERE k.attnum > 0
          ORDER BY k.ord
        )::text[] AS columns
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_class c_idx ON c_idx.oid = i.indexrelid
      WHERE n.nspname = ANY($1::text[])
      ORDER BY i.indrelid, c_idx.relname`,
      [schemas],
    );

    await client.query('COMMIT');

    // Grouping by relation
    const columnsByRel = new Map<number, RawColumnInfo[]>();
    for (const c of colsRes.rows) {
      const list = columnsByRel.get(c.rel_oid) ?? [];
      list.push({
        name: c.name,
        type: c.type,
        notNull: c.not_null,
        default: c.default_expr,
        ordinal: c.ordinal,
        description: c.description,
      });
      columnsByRel.set(c.rel_oid, list);
    }

    const pksByRel = new Map<number, string[]>();
    const uniquesByRel = new Map<number, string[][]>();
    const fksByRel = new Map<number, RawForeignKeyInfo[]>();

    for (const con of consRes.rows) {
      const cols = parsePgArray(con.columns);
      if (con.type === 'p') {
        pksByRel.set(con.rel_oid, cols);
      } else if (con.type === 'u') {
        const list = uniquesByRel.get(con.rel_oid) ?? [];
        list.push(cols);
        uniquesByRel.set(con.rel_oid, list);
      } else if (con.type === 'f' && con.ref_schema && con.ref_table) {
        const list = fksByRel.get(con.rel_oid) ?? [];
        list.push({
          name: con.name,
          columns: cols,
          references: {
            schema: con.ref_schema,
            relation: con.ref_table,
            columns: parsePgArray(con.ref_columns),
          },
          onDelete: mapOnDelete(con.on_delete_action ?? 'a'),
        });
        fksByRel.set(con.rel_oid, list);
      }
    }

    const indexesByRel = new Map<number, RawIndexInfo[]>();
    for (const idx of idxsRes.rows) {
      const list = indexesByRel.get(idx.rel_oid) ?? [];
      list.push({
        name: idx.name,
        columns: parsePgArray(idx.columns),
        unique: idx.is_unique,
        primary: idx.is_primary,
        definition: idx.definition,
      });
      indexesByRel.set(idx.rel_oid, list);
    }

    const relations: RawRelationInfo[] = relsRes.rows.map((row) => ({
      oid: row.oid,
      schema: row.schema,
      name: row.name,
      kind: row.kind,
      kindName: mapRelationKind(row.kind),
      description: row.description,
      rowEstimate: Number(row.row_estimate),
      relrowsecurity: row.relrowsecurity,
      relforcerowsecurity: row.relforcerowsecurity,
      owner: row.owner,
      columns: columnsByRel.get(row.oid) ?? [],
      primaryKey: pksByRel.get(row.oid) ?? null,
      uniqueKeys: uniquesByRel.get(row.oid) ?? [],
      foreignKeys: fksByRel.get(row.oid) ?? [],
      indexes: indexesByRel.get(row.oid) ?? [],
    }));

    return {
      serverVersionNum,
      currentUser,
      relations,
    };
  } catch (err) {
    broken = true;
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (shouldRelease && 'release' in client) {
      (client as pg.PoolClient).release(broken ? true : undefined);
    }
  }
}
