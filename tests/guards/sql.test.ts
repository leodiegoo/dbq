import { describe, expect, it } from 'vitest';
import { guardSql } from '../../src/guards/sql.ts';
import { DbqError } from '../../src/errors.ts';

const refuses = (sql: string) => {
  let thrown: unknown;
  try {
    guardSql(sql);
  } catch (err) {
    thrown = err;
  }
  expect(thrown, `should refuse: ${sql}`).toBeInstanceOf(DbqError);
  expect((thrown as DbqError).code, `should refuse: ${sql}`).toBe('READONLY_VIOLATION');
};

describe('guardSql — accepted queries', () => {
  it('should be accepting a plain select', () => {
    expect(guardSql('SELECT id FROM companies')).toEqual({
      kind: 'sql',
      statement: 'SELECT id FROM companies',
    });
  });

  it('should be accepting select regardless of keyword case', () => {
    expect(guardSql('select 1').kind).toBe('sql');
  });

  it('should be accepting a with clause feeding a select', () => {
    expect(guardSql('WITH x AS (SELECT 1 AS n) SELECT n FROM x').kind).toBe('sql');
  });

  it('should be accepting show, describe and explain', () => {
    expect(guardSql('SHOW TABLES').kind).toBe('sql');
    expect(guardSql('DESCRIBE companies').kind).toBe('sql');
    expect(guardSql('EXPLAIN SELECT 1').kind).toBe('sql');
  });

  it('should be accepting a trailing semicolon as a single statement', () => {
    expect(guardSql('SELECT 1;').statement).toBe('SELECT 1');
  });

  it('should be accepting a semicolon inside a string literal', () => {
    expect(guardSql("SELECT * FROM t WHERE name = 'a;b'").kind).toBe('sql');
  });

  it('should be preserving the original text including comments', () => {
    expect(guardSql('SELECT 1 -- nota').statement).toBe('SELECT 1 -- nota');
  });
});

describe('guardSql — refused queries', () => {
  it('should be refusing every write statement', () => {
    for (const sql of [
      'INSERT INTO t VALUES (1)',
      'UPDATE t SET a = 1',
      'DELETE FROM t',
      'DROP TABLE t',
      'TRUNCATE t',
      'ALTER TABLE t ADD COLUMN a INT',
      'CREATE TABLE t (a INT)',
      'REPLACE INTO t VALUES (1)',
      'GRANT ALL ON *.* TO x',
      'CALL some_proc()',
      'SET GLOBAL max_connections = 1',
    ]) {
      refuses(sql);
    }
  });

  it('should be refusing a write hidden behind a block comment', () => {
    refuses('/* inofensivo */ DROP TABLE companies');
  });

  it('should be refusing a write hidden behind a line comment', () => {
    refuses('-- nada aqui\nDELETE FROM companies');
  });

  it('should be refusing a write hidden behind a hash comment', () => {
    refuses('# nada\nDROP TABLE companies');
  });

  it('should be refusing chained statements', () => {
    refuses('SELECT 1; DROP TABLE companies');
  });

  it('should be refusing select into outfile', () => {
    refuses("SELECT * FROM t INTO OUTFILE '/tmp/x'");
  });

  it('should be refusing select into dumpfile', () => {
    refuses("SELECT * FROM t INTO DUMPFILE '/tmp/x'");
  });

  it('should be refusing select for update', () => {
    refuses('SELECT * FROM t FOR UPDATE');
  });

  it('should be refusing select lock in share mode', () => {
    refuses('SELECT * FROM t LOCK IN SHARE MODE');
  });

  it('should be refusing a with clause that is not read-only', () => {
    refuses('WITH x AS (SELECT 1) DELETE FROM t');
  });

  it('should be refusing an empty query', () => {
    refuses('   ');
  });

  it('should be attaching a hint listing the allowed keywords', () => {
    try {
      guardSql('DROP TABLE t');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DbqError).hint).toContain('SELECT');
    }
  });
});
