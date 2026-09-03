import { describe, expect, it } from 'vitest';
import { DbqError, scrubUri, toConnectionError, toDbqError } from '../src/errors.ts';

describe('DbqError', () => {
  it('should be mapping each code to its documented exit code', () => {
    expect(new DbqError('USAGE', 'x').exitCode).toBe(2);
    expect(new DbqError('READONLY_VIOLATION', 'x').exitCode).toBe(3);
    expect(new DbqError('CONNECTION_ERROR', 'x').exitCode).toBe(4);
    expect(new DbqError('DATABASE_ERROR', 'x').exitCode).toBe(5);
    expect(new DbqError('TIMEOUT', 'x').exitCode).toBe(6);
    expect(new DbqError('UNEXPECTED', 'x').exitCode).toBe(1);
  });

  it('should be carrying an optional hint', () => {
    expect(new DbqError('READONLY_VIOLATION', 'x', 'tente find').hint).toBe('tente find');
    expect(new DbqError('USAGE', 'x').hint).toBeUndefined();
  });
});

describe('scrubUri', () => {
  it('should be removing the password from a mysql uri', () => {
    expect(scrubUri('falhou em mysql://leitura:s3nh4@10.0.0.1:3306/db')).toBe(
      'falhou em mysql://leitura:***@10.0.0.1:3306/db',
    );
  });

  it('should be removing the password from a mongodb uri', () => {
    expect(scrubUri('mongodb+srv://user:p%40ss@cluster.example.net/appdb')).toBe(
      'mongodb+srv://user:***@cluster.example.net/appdb',
    );
  });

  it('should be leaving a uri without credentials untouched', () => {
    expect(scrubUri('mongodb://localhost:27017/db')).toBe('mongodb://localhost:27017/db');
  });

  it('should be scrubbing every uri in a multi-line message', () => {
    const scrubbed = scrubUri('a mysql://u:p1@h/d\nb mongodb://u:p2@h/d');
    expect(scrubbed).not.toContain('p1');
    expect(scrubbed).not.toContain('p2');
  });
});

describe('toDbqError', () => {
  it('should be passing a DbqError through unchanged', () => {
    const original = new DbqError('TIMEOUT', 'estourou');
    expect(toDbqError(original)).toBe(original);
  });

  it('should be classifying driver auth failures as connection errors', () => {
    const err = Object.assign(new Error('Access denied for user'), { code: 'ER_ACCESS_DENIED_ERROR' });
    expect(toDbqError(err).code).toBe('CONNECTION_ERROR');
  });

  it('should be classifying refused sockets as connection errors', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(toDbqError(err).code).toBe('CONNECTION_ERROR');
  });

  it('should be classifying timeouts as timeout errors', () => {
    const err = Object.assign(new Error('operation exceeded time limit'), { codeName: 'MaxTimeMSExpired' });
    expect(toDbqError(err).code).toBe('TIMEOUT');
  });

  it('should be classifying unknown driver errors as database errors', () => {
    const err = Object.assign(new Error('Unknown column x'), { code: 'ER_BAD_FIELD_ERROR' });
    expect(toDbqError(err).code).toBe('DATABASE_ERROR');
  });

  it('should be scrubbing credentials out of the converted message', () => {
    const err = new Error('failed on mysql://u:hunter2@h:3306/d');
    expect(toDbqError(err).message).not.toContain('hunter2');
  });
});

describe('toConnectionError', () => {
  it('should be reclassifying a connect-phase ETIMEDOUT as a connection error', () => {
    const err = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
    expect(toDbqError(err).code).toBe('TIMEOUT');
    expect(toConnectionError(err).code).toBe('CONNECTION_ERROR');
  });

  it('should be replacing the misleading query hint with a connectivity one', () => {
    const err = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
    expect(toConnectionError(err).hint).toContain('rede');
    expect(toConnectionError(err).hint).not.toContain('escopo da query');
  });

  it('should be preserving an error already classified as a connection error', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(toConnectionError(err).code).toBe('CONNECTION_ERROR');
  });

  it('should be scrubbing credentials out of the connection error message', () => {
    const err = new Error('failed on mysql://u:hunter2@h:3306/d');
    expect(toConnectionError(err).message).not.toContain('hunter2');
  });
});
