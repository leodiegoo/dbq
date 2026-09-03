import pg from 'pg';
import Cursor from 'pg-cursor';
import { toConnectionError, toDbqError } from '../errors.ts';
import type { PostgresConnection } from '../config/types.ts';
import type { SqlPlan } from '../guards/types.ts';
import { applyLimit } from '../output/envelope.ts';
import type { ExecuteOptions, ExecuteResult } from './mysql.ts';

/** --database overrides the database in the URI path; without the flag, the path wins. */
const withDatabase = (uri: string, database: string | undefined): string => {
  if (database === undefined) return uri;
  const url = new URL(uri);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.toString();
};

/**
 * A cursor needs a real query. SHOW and EXPLAIN are utility statements that
 * DECLARE CURSOR rejects — they also return few rows, so buffering them costs
 * nothing.
 */
const CURSORABLE = /^\s*(SELECT|WITH|TABLE|VALUES)\b/i;

/**
 * PostgreSQL is the one engine where read-only is enforced by the server as
 * well as by the guard: inside a READ ONLY transaction the backend itself
 * rejects any write, so a hole in the parser is not a hole in the guarantee.
 * `statement_timeout` is server-side for the same reason — better than racing a
 * socket timeout from the client.
 */
export const executePostgres = async (
  connection: PostgresConnection,
  plan: SqlPlan,
  opts: ExecuteOptions,
): Promise<ExecuteResult> => {
  const client = new pg.Client({
    connectionString: withDatabase(connection.uri, opts.database),
    connectionTimeoutMillis: opts.timeoutMs,
  });

  try {
    await client.connect().catch((err: unknown) => {
      throw toConnectionError(err);
    });

    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${Number(opts.timeoutMs)}`);

    // EXPLAIN without ANALYZE: ANALYZE would actually run the statement.
    const statement = opts.explain ? `EXPLAIN ${plan.statement}` : plan.statement;
    const fetch = opts.limit > 0 ? opts.limit + 1 : 0;

    let rows: unknown[];
    if (fetch > 0 && !opts.explain && CURSORABLE.test(statement)) {
      // Read only the ceiling plus one. Without a cursor the driver buffers the
      // entire result before we could truncate it, which is exactly the volume
      // problem the ceiling exists to prevent.
      const cursor = client.query(new Cursor(statement));
      rows = await cursor.read(fetch);
      await cursor.close().catch(() => undefined);
    } else {
      const result = await client.query<Record<string, unknown>>(statement);
      rows = result.rows;
    }

    return applyLimit(rows, opts.limit);
  } catch (err) {
    throw toDbqError(err);
  } finally {
    // The transaction is never committed: nothing it did should survive.
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end().catch(() => undefined);
  }
};
