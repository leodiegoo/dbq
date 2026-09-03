import { DbqError } from '../errors.ts';
import type { MysqlConnection } from '../config/types.ts';
import { executeMysql } from '../engines/mysql.ts';

const IDENTIFIER = /^[A-Za-z0-9_$]+$/;

export const mysqlSchema = async (
  connection: MysqlConnection,
  table: string | undefined,
  opts: { timeoutMs: number },
): Promise<unknown[]> => {
  if (table !== undefined && !IDENTIFIER.test(table)) {
    throw new DbqError('USAGE', `nome de tabela invalido: '${table}'`, 'use apenas letras, numeros e underscore');
  }

  // A interpolacao e segura porque o IDENTIFIER acima ja recusou tudo que nao
  // seja [A-Za-z0-9_$]: nenhuma crase, aspa, espaco ou `;` sobrevive a checagem.
  const statement = table === undefined ? 'SHOW TABLES' : `DESCRIBE \`${table}\``;

  const result = await executeMysql(
    connection,
    { kind: 'sql', statement },
    { limit: 0, timeoutMs: opts.timeoutMs, explain: false },
  );

  return result.rows;
};
