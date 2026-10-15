import { createConnection } from 'mysql2';
import { DbqError, scrubUri, toConnectionError, toDbqError } from '../errors.ts';
import type { MysqlConnection } from '../config/types.ts';
import type { SqlPlan } from '../guards/types.ts';
import { applyLimit } from '../output/envelope.ts';

export type ExecuteOptions = { limit: number; timeoutMs: number; explain: boolean; database?: string };

/** --database overrides the database in the URI path; without the flag, the path wins. */
const withDatabase = (uri: string, database: string | undefined): string => {
  if (database === undefined) return uri;
  const url = new URL(uri);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.toString();
};
export type ExecuteResult = { rows: unknown[]; truncated: boolean };

const KILL_TIMEOUT_MS = 5000;
const ER_NO_SUCH_THREAD = 1094;

/**
 * Dropping the client socket or hitting the driver timeout leaves the query
 * running on the server. This is the one statement dbq ever sends besides
 * reads, and it targets only the thread of dbq's own connection, over a short
 * side connection because the main one is busy running the query. Returns a
 * warning when the kill did not land, so callers can surface it.
 */
const killQuery = async (uri: string, threadId: number): Promise<string | undefined> => {
  const side = createConnection({ uri, connectTimeout: KILL_TIMEOUT_MS });
  try {
    await new Promise<void>((resolve, reject) => {
      side.connect((err) => (err ? reject(err) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      // threadId comes from the driver handshake, never from user input.
      side.query({ sql: `KILL QUERY ${Math.trunc(threadId)}`, timeout: KILL_TIMEOUT_MS }, (err) => {
        // The thread is already gone: the query is not running, which is the goal.
        if (err && (err as { errno?: number }).errno !== ER_NO_SUCH_THREAD) reject(err);
        else resolve();
      });
    });
    return undefined;
  } catch (err) {
    const reason = scrubUri(err instanceof Error ? err.message : String(err));
    return `warning: could not stop the query on the server (thread ${threadId}); it may still be running: ${reason}`;
  } finally {
    side.destroy();
  }
};

export const executeMysql = async (
  connection: MysqlConnection,
  plan: SqlPlan,
  opts: ExecuteOptions,
): Promise<ExecuteResult> => {
  const uri = withDatabase(connection.uri, opts.database);
  const client = createConnection({
    uri,
    // Defence in depth at the driver: even if the guard failed, the server
    // would reject any attempt to chain a second statement.
    multipleStatements: false,
    connectTimeout: opts.timeoutMs,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });

  let destroyed = false;
  let running = false;

  /** Stops the server-side query if it is still running; no-op otherwise. */
  const abandon = async (): Promise<string | undefined> => {
    if (!running) return undefined;
    running = false;
    const threadId = client.threadId;
    const warning = threadId ? await killQuery(uri, threadId) : undefined;
    destroyed = true;
    client.destroy();
    return warning;
  };

  const onSignal = (signal: NodeJS.Signals) => {
    void abandon().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };

  try {
    await new Promise<void>((resolve, reject) => {
      client.connect((err) => (err ? reject(toConnectionError(err)) : resolve()));
    });

    const statement = opts.explain ? `EXPLAIN ${plan.statement}` : plan.statement;
    const fetch = opts.limit > 0 ? opts.limit + 1 : 0;

    running = true;
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);

    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const collected: unknown[] = [];
      const stream = client.query({ sql: statement, timeout: opts.timeoutMs });

      stream.on('error', reject);
      stream.on('result', (row: unknown) => {
        collected.push(row);
        // Stop consuming as soon as the extra row arrives: the ceiling exists
        // to protect the consumer's session, so fetching the rest is waste.
        if (fetch > 0 && collected.length >= fetch && running) {
          void abandon().then((warning) => {
            if (warning) process.stderr.write(`${warning}\n`);
            resolve(collected);
          });
        }
      });
      stream.on('end', () => {
        running = false;
        resolve(collected);
      });
    });

    const normalized = rows.map((row) =>
      row !== null && typeof row === 'object' ? { ...(row as object) } : row,
    );

    return applyLimit(normalized, opts.limit);
  } catch (err) {
    const converted = toDbqError(err);
    // A server-reported error (it carries an sqlState) means the query already
    // ended; timeouts and socket failures do not, and leave it running.
    if ((err as { sqlState?: unknown } | null)?.sqlState !== undefined) running = false;
    const warning = await abandon();
    if (!warning) throw converted;
    throw new DbqError(converted.code, `${converted.message}\n${warning}`, converted.hint);
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    if (!destroyed) {
      await new Promise<void>((resolve) => {
        client.end(() => resolve());
      }).catch(() => undefined);
    }
  }
};
