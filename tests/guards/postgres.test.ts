import { describe, expect, it } from 'vitest';
import { guardPostgres } from '../../src/guards/postgres.ts';
import { DbqError } from '../../src/errors.ts';

const refuses = (sql: string) => {
  let thrown: unknown;
  try {
    guardPostgres(sql);
  } catch (err) {
    thrown = err;
  }
  expect(thrown, `should refuse: ${sql}`).toBeInstanceOf(DbqError);
  expect((thrown as DbqError).code, `should refuse: ${sql}`).toBe('READONLY_VIOLATION');
};

describe('guardPostgres — accepted queries', () => {
  it('should be accepting a plain select', () => {
    expect(guardPostgres('SELECT id FROM companies')).toEqual({
      kind: 'sql',
      statement: 'SELECT id FROM companies',
    });
  });

  it('should be accepting a read-only common table expression', () => {
    expect(guardPostgres('WITH x AS (SELECT 1 AS n) SELECT n FROM x').kind).toBe('sql');
  });

  it('should be accepting the TABLE and VALUES shorthands', () => {
    expect(guardPostgres('TABLE companies').kind).toBe('sql');
    expect(guardPostgres('VALUES (1), (2)').kind).toBe('sql');
  });

  it('should be accepting show and explain', () => {
    expect(guardPostgres('SHOW statement_timeout').kind).toBe('sql');
    expect(guardPostgres('EXPLAIN SELECT 1').kind).toBe('sql');
  });

  it('should be accepting a column whose name merely contains a write keyword', () => {
    expect(guardPostgres('SELECT deleted_at, updated_at, created_at FROM t').kind).toBe('sql');
  });

  it('should be accepting a write keyword inside a string literal', () => {
    expect(guardPostgres("SELECT * FROM t WHERE action = 'DELETE'").kind).toBe('sql');
  });

  it('should be accepting a write keyword inside a quoted identifier', () => {
    expect(guardPostgres('SELECT "delete" FROM t').kind).toBe('sql');
  });

  it('should be accepting a semicolon inside a string literal', () => {
    expect(guardPostgres("SELECT * FROM t WHERE name = 'a;b'").kind).toBe('sql');
  });

  it('should be accepting a doubled quote escape inside a string', () => {
    expect(guardPostgres("SELECT * FROM t WHERE name = 'O''Brien'").kind).toBe('sql');
  });

  it('should be accepting a trailing semicolon', () => {
    expect(guardPostgres('SELECT 1;').statement).toBe('SELECT 1');
  });

  it('should be accepting a case expression ending in END', () => {
    expect(guardPostgres('SELECT CASE WHEN a THEN 1 ELSE 2 END FROM t').kind).toBe('sql');
  });

  it('should be accepting a dollar-quoted string, which is inert text and not execution', () => {
    // $$ ... $$ is alternative string-literal syntax: this returns the text
    // 'DROP TABLE t' and executes nothing, exactly like SELECT 'DROP TABLE t'.
    // Execution only enters through DO, which is refused separately.
    expect(guardPostgres('SELECT $$ DROP TABLE t $$').kind).toBe('sql');
    expect(guardPostgres('SELECT $tag$ DELETE FROM t $tag$').kind).toBe('sql');
  });
});

describe('guardPostgres — refused queries', () => {
  it('should be refusing every leading write statement', () => {
    for (const sql of [
      'INSERT INTO t VALUES (1)',
      'UPDATE t SET a = 1',
      'DELETE FROM t',
      'MERGE INTO t USING s ON true WHEN MATCHED THEN DELETE',
      'TRUNCATE t',
      'DROP TABLE t',
      'ALTER TABLE t ADD COLUMN a int',
      'CREATE TABLE t (a int)',
      'GRANT ALL ON t TO x',
      'CALL proc()',
      'VACUUM t',
      'REINDEX TABLE t',
      'REFRESH MATERIALIZED VIEW v',
    ]) {
      refuses(sql);
    }
  });

  it('should be refusing a data-modifying CTE, which starts with WITH and ends in SELECT', () => {
    refuses('WITH x AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM x');
    refuses('WITH x AS (UPDATE t SET a = 1 RETURNING *) SELECT * FROM x');
    refuses('WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x');
  });

  it('should be refusing COPY TO PROGRAM, which executes a shell command', () => {
    refuses("COPY t TO PROGRAM 'curl http://x'");
    refuses("COPY (SELECT 1) TO PROGRAM 'sh'");
  });

  it('should be refusing COPY to or from a file', () => {
    refuses("COPY t TO '/tmp/x'");
    refuses("COPY t FROM '/tmp/x'");
  });

  it('should be refusing filesystem-reading functions', () => {
    refuses("SELECT pg_read_file('/etc/passwd')");
    refuses("SELECT pg_read_binary_file('/etc/passwd')");
    refuses("SELECT pg_ls_dir('/')");
    refuses("SELECT lo_export(1, '/tmp/x')");
    refuses("SELECT lo_import('/tmp/x')");
  });

  it('should be refusing sequence mutation', () => {
    refuses("SELECT nextval('s')");
    refuses("SELECT setval('s', 1)");
  });

  it('should be refusing anything that holds the connection or the server', () => {
    refuses('SELECT pg_sleep(10)');
    refuses('SELECT pg_advisory_lock(1)');
    refuses('SELECT pg_terminate_backend(1)');
    refuses('LOCK TABLE t');
  });

  it('should be refusing row locks', () => {
    refuses('SELECT * FROM t FOR UPDATE');
    refuses('SELECT * FROM t FOR NO KEY UPDATE');
    refuses('SELECT * FROM t FOR SHARE');
    refuses('SELECT * FROM t FOR KEY SHARE');
  });

  it('should be refusing outbound connections from the server', () => {
    refuses("SELECT dblink('host=evil', 'SELECT 1')");
  });

  it('should be refusing EXPLAIN ANALYZE, which actually runs the query', () => {
    refuses('EXPLAIN ANALYZE SELECT 1');
    refuses('EXPLAIN (ANALYZE, BUFFERS) SELECT 1');
  });

  it('should be refusing anonymous code blocks', () => {
    refuses("DO $$ BEGIN PERFORM 1; END $$");
  });

  it('should be refusing a statement hidden inside a dollar-quoted code block', () => {
    // The danger of dollar quoting is DO, which executes its body. The body
    // itself is inert text either way.
    refuses("DO $tag$ BEGIN PERFORM 1; END $tag$");
  });

  it('should be refusing a write hidden behind a comment', () => {
    refuses('/* harmless */ DROP TABLE companies');
    refuses('-- nothing\nDELETE FROM companies');
  });

  it('should be refusing a write hidden behind a nested block comment', () => {
    refuses('/* outer /* inner */ still comment */ DROP TABLE t');
  });

  it('should be refusing chained statements', () => {
    refuses('SELECT 1; DROP TABLE companies');
  });

  it('should be refusing transaction control, which the engine owns', () => {
    refuses('BEGIN');
    refuses('COMMIT');
    refuses('ROLLBACK');
    refuses('SET statement_timeout = 0');
  });

  it('should be refusing prepared-statement execution', () => {
    refuses('EXECUTE stmt');
    refuses('PREPARE stmt AS SELECT 1');
  });

  it('should be refusing an empty query', () => {
    refuses('   ');
  });

  it('should be attaching a hint listing the allowed keywords', () => {
    try {
      guardPostgres('DROP TABLE t');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DbqError).hint).toContain('SELECT');
    }
  });
});
