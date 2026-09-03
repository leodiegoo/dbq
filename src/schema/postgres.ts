import { DbqError } from '../errors.ts';
import type { PostgresConnection } from '../config/types.ts';
import { executePostgres } from '../engines/postgres.ts';

/**
 * PostgreSQL has schemas (namespaces) inside a database, an axis MySQL and
 * Mongo lack. Rather than adding a flag, results are qualified (`public.users`)
 * and a target may be given either bare or qualified — the extra axis shows up
 * where it helps, not in every invocation.
 */
const TARGET = /^([A-Za-z0-9_$]+)(?:\.([A-Za-z0-9_$]+))?$/;

const SYSTEM_SCHEMAS = "('pg_catalog', 'information_schema')";

const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export const postgresSchema = async (
  connection: PostgresConnection,
  target: string | undefined,
  opts: { timeoutMs: number; database?: string },
): Promise<unknown[]> => {
  const run = async (statement: string): Promise<unknown[]> => {
    const result = await executePostgres(
      connection,
      { kind: 'sql', statement },
      { limit: 0, timeoutMs: opts.timeoutMs, explain: false, database: opts.database },
    );
    return result.rows;
  };

  if (target === undefined) {
    return run(`
      SELECT table_schema AS schema, table_name AS name, table_type AS type
      FROM information_schema.tables
      WHERE table_schema NOT IN ${SYSTEM_SCHEMAS}
      ORDER BY table_schema, table_name
    `);
  }

  const parsed = TARGET.exec(target);
  if (!parsed) {
    throw new DbqError(
      'USAGE',
      `invalid table name: '${target}'`,
      'use <table> or <schema>.<table>, letters, digits and underscores only',
    );
  }

  // Interpolation is safe because TARGET already rejected anything outside
  // [A-Za-z0-9_$.], and each part is additionally quoted as a string literal.
  const [, first, second] = parsed;
  const where =
    second === undefined
      ? `c.table_name = ${quote(first as string)} AND c.table_schema NOT IN ${SYSTEM_SCHEMAS}`
      : `c.table_schema = ${quote(first as string)} AND c.table_name = ${quote(second)}`;

  return run(`
    SELECT c.table_schema AS schema, c.column_name AS column, c.data_type AS type,
           c.is_nullable AS nullable, c.column_default AS "default"
    FROM information_schema.columns c
    WHERE ${where}
    ORDER BY c.table_schema, c.ordinal_position
  `);
};

export const postgresDatabases = async (
  connection: PostgresConnection,
  opts: { timeoutMs: number; database?: string },
): Promise<unknown[]> => {
  const result = await executePostgres(
    connection,
    { kind: 'sql', statement: 'SELECT datname AS database FROM pg_database WHERE NOT datistemplate ORDER BY datname' },
    { limit: 0, timeoutMs: opts.timeoutMs, explain: false, database: opts.database },
  );
  return result.rows;
};
