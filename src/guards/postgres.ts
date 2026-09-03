import { DbqError } from '../errors.ts';
import type { SqlPlan } from './types.ts';

const ALLOWED_LEADING = ['SELECT', 'WITH', 'TABLE', 'VALUES', 'EXPLAIN', 'SHOW'];

/**
 * Unlike MySQL, a write keyword may appear anywhere in a PostgreSQL statement:
 * `WITH x AS (INSERT ... RETURNING *) SELECT * FROM x` starts at WITH, ends in
 * SELECT, and writes. So the leading-keyword check is not enough — nothing on
 * this list may appear at any position.
 */
const WRITE_KEYWORD =
  /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|DROP|ALTER|GRANT|REVOKE|COMMENT|COPY|CALL|DO|EXECUTE|PREPARE|DEALLOCATE|VACUUM|ANALYZE|REINDEX|CLUSTER|REFRESH|SET|RESET|LOCK|LISTEN|NOTIFY|UNLISTEN|IMPORT|SECURITY|CHECKPOINT|DISCARD|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|START)\b/i;

const FORBIDDEN_FRAGMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bTO\s+PROGRAM\b/i, 'COPY TO PROGRAM executes a shell command on the server'],
  [/\blo_export\b/i, 'lo_export writes a file on the server'],
  [/\blo_import\b/i, 'lo_import reads a file on the server'],
  [/\bpg_read_file\b/i, 'pg_read_file reads the server filesystem'],
  [/\bpg_read_binary_file\b/i, 'pg_read_binary_file reads the server filesystem'],
  [/\bpg_ls_dir\b/i, 'pg_ls_dir lists the server filesystem'],
  [/\bpg_stat_file\b/i, 'pg_stat_file inspects the server filesystem'],
  [/\bnextval\b/i, 'nextval advances a sequence'],
  [/\bsetval\b/i, 'setval mutates a sequence'],
  [/\bpg_sleep(_for|_until)?\b/i, 'pg_sleep holds the connection open'],
  [/\bpg_advisory(_xact)?_lock\b/i, 'advisory locks are a side effect'],
  [/\bpg_terminate_backend\b/i, 'pg_terminate_backend kills another session'],
  [/\bpg_cancel_backend\b/i, 'pg_cancel_backend interrupts another session'],
  [/\bdblink\b/i, 'dblink opens an outbound connection from the server'],
  [/\bFOR\s+(NO\s+KEY\s+)?UPDATE\b/i, 'FOR UPDATE takes row locks'],
  [/\bFOR\s+(KEY\s+)?SHARE\b/i, 'FOR SHARE takes row locks'],
];

const HINT = `read-only statements: ${ALLOWED_LEADING.join(', ')}`;

const refuse = (reason: string): never => {
  throw new DbqError('READONLY_VIOLATION', reason, HINT);
};

const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/**
 * PostgreSQL lexes differently from MySQL, so the MySQL normaliser cannot be
 * reused: `"` delimits an identifier rather than a string, block comments nest,
 * and `$$ ... $$` dollar quoting can hide an entire statement.
 *
 * Comments are dropped; string and identifier bodies are replaced with inert
 * placeholders. A `;` inside quotes must not read as statement chaining, and a
 * `DROP` inside a comment, a string or a dollar-quoted block must not slip past
 * the keyword scan — while a column legitimately named `"delete"` must.
 */
const normalize = (sql: string): string => {
  let out = '';
  let i = 0;

  while (i < sql.length) {
    if (sql.startsWith('/*', i)) {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql.startsWith('/*', i)) {
          depth += 1;
          i += 2;
        } else if (sql.startsWith('*/', i)) {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      out += ' ';
      continue;
    }

    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      out += ' ';
      continue;
    }

    const dollar = DOLLAR_TAG.exec(sql.slice(i));
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      i = end === -1 ? sql.length : end + tag.length;
      out += "''";
      continue;
    }

    if (sql[i] === "'") {
      // An E'' string uses backslash escapes; a standard string only doubles
      // the quote.
      const escaped = /[Ee]$/.test(out);
      i += 1;
      while (i < sql.length) {
        if (escaped && sql[i] === '\\') {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
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

    if (sql[i] === '"') {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      out += '"x"';
      continue;
    }

    out += sql[i];
    i += 1;
  }

  return out;
};

export const guardPostgres = (raw: string): SqlPlan => {
  const statement = raw.trim().replace(/;\s*$/, '').trim();
  if (statement.length === 0) refuse('empty query');

  const normalized = normalize(statement);

  if (normalized.includes(';')) {
    refuse('multiple statements are not allowed');
  }

  const leading = normalized.trim().match(/^([A-Za-z_]+)/)?.[1]?.toUpperCase() ?? '';
  if (!ALLOWED_LEADING.includes(leading)) {
    refuse(`statement '${leading || raw.trim().slice(0, 20)}' is not a read operation`);
  }

  const write = WRITE_KEYWORD.exec(normalized);
  if (write) {
    refuse(`'${write[1]?.toUpperCase()}' is not allowed anywhere in the statement`);
  }

  for (const [pattern, reason] of FORBIDDEN_FRAGMENTS) {
    if (pattern.test(normalized)) refuse(reason);
  }

  return { kind: 'sql', statement };
};
