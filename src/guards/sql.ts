import { DbqError } from '../errors.ts';
import type { SqlPlan } from './types.ts';

const ALLOWED_LEADING = ['SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'];

const FORBIDDEN_FRAGMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bINTO\s+OUTFILE\b/i, 'INTO OUTFILE escreve arquivo no servidor'],
  [/\bINTO\s+DUMPFILE\b/i, 'INTO DUMPFILE escreve arquivo no servidor'],
  [/\bFOR\s+UPDATE\b/i, 'FOR UPDATE trava linhas'],
  [/\bLOCK\s+IN\s+SHARE\s+MODE\b/i, 'LOCK IN SHARE MODE trava linhas'],
  [/\bINTO\s+@/i, 'SELECT INTO variavel nao e leitura pura'],
];

const WRITE_KEYWORD =
  /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|REPLACE|GRANT|REVOKE|RENAME|CALL|LOAD|HANDLER|SET)\b/i;

const HINT = `apenas leitura: ${ALLOWED_LEADING.join(', ')}`;

const refuse = (reason: string): never => {
  throw new DbqError('READONLY_VIOLATION', reason, HINT);
};

/**
 * Remove comentarios e o conteudo de literais de string. Um `;` dentro de aspas
 * nao pode contar como encadeamento, e um `DROP` escondido atras de um bloco de
 * comentario nao pode escapar da checagem da primeira palavra-chave.
 */
const normalize = (sql: string): string => {
  let out = '';
  let i = 0;

  while (i < sql.length) {
    const two = sql.slice(i, i + 2);

    if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += ' ';
      continue;
    }

    if (two === '--' || sql[i] === '#') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      out += ' ';
      continue;
    }

    const quote = sql[i];
    if (quote === "'" || quote === '"' || quote === '`') {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === '\\') {
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      out += "''";
      continue;
    }

    out += sql[i];
    i += 1;
  }

  return out;
};

export const guardSql = (raw: string): SqlPlan => {
  const statement = raw.trim().replace(/;\s*$/, '').trim();
  if (statement.length === 0) refuse('query vazia');

  const normalized = normalize(statement);

  if (normalized.includes(';')) {
    refuse('multiplos statements nao sao permitidos');
  }

  const leading = normalized.trim().match(/^([A-Za-z_]+)/)?.[1]?.toUpperCase() ?? '';
  if (!ALLOWED_LEADING.includes(leading)) {
    refuse(`statement '${leading || raw.trim().slice(0, 20)}' nao e uma operacao de leitura`);
  }

  if (leading === 'WITH') {
    const body = normalized.replace(/^\s*WITH\b/i, '');
    const tail = body.slice(body.lastIndexOf(')') + 1);
    if (WRITE_KEYWORD.test(tail)) {
      refuse('a clausula WITH precisa terminar em SELECT');
    }
  }

  for (const [pattern, reason] of FORBIDDEN_FRAGMENTS) {
    if (pattern.test(normalized)) refuse(reason);
  }

  return { kind: 'sql', statement };
};
