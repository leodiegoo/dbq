import { createConnection } from 'mysql2';
import { toConnectionError, toDbqError } from '../errors.ts';
import type { MysqlConnection } from '../config/types.ts';
import type { SqlPlan } from '../guards/types.ts';
import { applyLimit } from '../output/envelope.ts';

export type ExecuteOptions = { limit: number; timeoutMs: number; explain: boolean; database?: string };

/** --database sobrescreve o banco do path da URI; sem a flag, o path manda. */
const withDatabase = (uri: string, database: string | undefined): string => {
  if (database === undefined) return uri;
  const url = new URL(uri);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.toString();
};
export type ExecuteResult = { rows: unknown[]; truncated: boolean };

export const executeMysql = async (
  connection: MysqlConnection,
  plan: SqlPlan,
  opts: ExecuteOptions,
): Promise<ExecuteResult> => {
  const client = createConnection({
    uri: withDatabase(connection.uri, opts.database),
    // Reforco no driver: mesmo que o guard falhasse, o servidor recusaria
    // qualquer tentativa de encadear um segundo statement.
    multipleStatements: false,
    connectTimeout: opts.timeoutMs,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });

  let destroyed = false;

  try {
    await new Promise<void>((resolve, reject) => {
      client.connect((err) => (err ? reject(toConnectionError(err)) : resolve()));
    });

    const statement = opts.explain ? `EXPLAIN ${plan.statement}` : plan.statement;
    const fetch = opts.limit > 0 ? opts.limit + 1 : 0;

    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const collected: unknown[] = [];
      const stream = client.query({ sql: statement, timeout: opts.timeoutMs });

      stream.on('error', reject);
      stream.on('result', (row: unknown) => {
        collected.push(row);
        // Para de consumir assim que a linha extra chega: o teto existe para
        // proteger a sessao do consumidor, entao nao adianta baixar o resto.
        if (fetch > 0 && collected.length >= fetch && !destroyed) {
          destroyed = true;
          client.destroy();
          resolve(collected);
        }
      });
      stream.on('end', () => resolve(collected));
    });

    const normalized = rows.map((row) =>
      row !== null && typeof row === 'object' ? { ...(row as object) } : row,
    );

    return applyLimit(normalized, opts.limit);
  } catch (err) {
    throw toDbqError(err);
  } finally {
    if (!destroyed) {
      await new Promise<void>((resolve) => {
        client.end(() => resolve());
      }).catch(() => undefined);
    }
  }
};
