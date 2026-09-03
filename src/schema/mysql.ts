import { DbqError } from '../errors.ts';
import type { MysqlConnection } from '../config/types.ts';
import { executeMysql } from '../engines/mysql.ts';

const IDENTIFIER = /^[A-Za-z0-9_$]+$/;

export const mysqlSchema = async (
  connection: MysqlConnection,
  table: string | undefined,
  opts: { timeoutMs: number; database?: string },
): Promise<unknown[]> => {
  if (table !== undefined && !IDENTIFIER.test(table)) {
    throw new DbqError('USAGE', `invalid table name: '${table}'`, 'use letters, digits and underscores only');
  }

  // The interpolation is safe because IDENTIFIER above already rejected
  // anything outside [A-Za-z0-9_$]: no backtick, quote, space or `;` survives.
  const statement = table === undefined ? 'SHOW TABLES' : `DESCRIBE \`${table}\``;

  const result = await executeMysql(
    connection,
    { kind: 'sql', statement },
    { limit: 0, timeoutMs: opts.timeoutMs, explain: false, database: opts.database },
  );

  return result.rows;
};
