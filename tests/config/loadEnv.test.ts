import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from '../../src/config/loadEnv.ts';
import { DbqError } from '../../src/errors.ts';

const temps: string[] = [];

const writeEnv = (content: unknown, mode = 0o600) => {
  const root = mkdtempSync(join(tmpdir(), 'dbq-'));
  temps.push(root);
  mkdirSync(join(root, 'proj'), { recursive: true });
  const file = join(root, 'proj', 'dev.json');
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  chmodSync(file, mode);
  return root;
};

const mysqlEnv = {
  connections: { mysql: { engine: 'mysql', uri: 'mysql://u:p@h:3306/d' } },
};

const bothEnv = {
  connections: {
    mysql: { engine: 'mysql', uri: 'mysql://u:p@h:3306/d' },
    mongo: { engine: 'mongodb', uri: 'mongodb://h:27017', database: 'appdb' },
  },
  defaults: { limit: 50, timeoutMs: 5000 },
};

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    return (err as DbqError).code;
  }
  throw new Error('deveria ter falhado');
};

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('loadEnv', () => {
  it('should be resolving the single connection when --db is omitted', () => {
    const root = writeEnv(mysqlEnv);
    const resolved = loadEnv({ root, project: 'proj', env: 'dev' });
    expect(resolved.name).toBe('mysql');
    expect(resolved.connection.engine).toBe('mysql');
  });

  it('should be applying the built-in defaults when nothing overrides them', () => {
    const root = writeEnv(mysqlEnv);
    const resolved = loadEnv({ root, project: 'proj', env: 'dev' });
    expect(resolved.limit).toBe(500);
    expect(resolved.timeoutMs).toBe(30_000);
  });

  it('should be preferring the file defaults over the built-in ones', () => {
    const root = writeEnv(bothEnv);
    const resolved = loadEnv({ root, project: 'proj', env: 'dev', db: 'mysql' });
    expect(resolved.limit).toBe(50);
    expect(resolved.timeoutMs).toBe(5000);
  });

  it('should be preferring the flags over the file defaults', () => {
    const root = writeEnv(bothEnv);
    const resolved = loadEnv({ root, project: 'proj', env: 'dev', db: 'mysql', limit: 7, timeoutMs: 900 });
    expect(resolved.limit).toBe(7);
    expect(resolved.timeoutMs).toBe(900);
  });

  it('should be accepting limit zero as an explicit uncapped request', () => {
    const root = writeEnv(bothEnv);
    expect(loadEnv({ root, project: 'proj', env: 'dev', db: 'mysql', limit: 0 }).limit).toBe(0);
  });

  it('should be requiring --db when the env declares more than one connection', () => {
    const root = writeEnv(bothEnv);
    expect(codeOf(() => loadEnv({ root, project: 'proj', env: 'dev' }))).toBe('USAGE');
  });

  it('should be refusing an unknown connection name', () => {
    const root = writeEnv(bothEnv);
    expect(codeOf(() => loadEnv({ root, project: 'proj', env: 'dev', db: 'redis' }))).toBe('USAGE');
  });

  it('should be refusing a missing env file and listing the available ones', () => {
    const root = writeEnv(mysqlEnv);
    try {
      loadEnv({ root, project: 'proj', env: 'prod' });
      expect.unreachable('deveria ter falhado');
    } catch (err) {
      expect((err as DbqError).code).toBe('USAGE');
      expect((err as DbqError).message).toContain('dev');
    }
  });

  it('should be refusing a file whose mode is not 0600', () => {
    const root = writeEnv(mysqlEnv, 0o644);
    expect(codeOf(() => loadEnv({ root, project: 'proj', env: 'dev' }))).toBe('USAGE');
  });

  it('should be refusing malformed json', () => {
    const root = writeEnv('{ nao e json');
    expect(codeOf(() => loadEnv({ root, project: 'proj', env: 'dev' }))).toBe('USAGE');
  });

  it('should be refusing an env with no connections', () => {
    const root = writeEnv({ connections: {} });
    expect(codeOf(() => loadEnv({ root, project: 'proj', env: 'dev' }))).toBe('USAGE');
  });

  it('should be refusing an unsupported engine', () => {
    const root = writeEnv({ connections: { pg: { engine: 'postgres', uri: 'postgres://h/d' } } });
    expect(codeOf(() => loadEnv({ root, project: 'proj', env: 'dev' }))).toBe('USAGE');
  });

  it('should be refusing a connection without a uri', () => {
    const root = writeEnv({ connections: { mysql: { engine: 'mysql' } } });
    expect(codeOf(() => loadEnv({ root, project: 'proj', env: 'dev' }))).toBe('USAGE');
  });

  it('should be keeping the configured database as the single source of truth', () => {
    const root = writeEnv({
      connections: { mongo: { engine: 'mongodb', uri: 'mongodb://h:27017/ignorado', database: 'real' } },
    });
    const resolved = loadEnv({ root, project: 'proj', env: 'dev' });
    expect(resolved.database).toBe('real');
    expect(resolved.connection).toEqual({
      engine: 'mongodb',
      uri: 'mongodb://h:27017/ignorado',
      database: 'real',
    });
  });

  it('should be leaving the database undefined when neither config nor flag supplies one', () => {
    const root = writeEnv({ connections: { mongo: { engine: 'mongodb', uri: 'mongodb://h:27017/ignorado' } } });
    expect(loadEnv({ root, project: 'proj', env: 'dev' }).database).toBeUndefined();
  });

  it('should be taking the database from the env file when no flag is passed', () => {
    const root = writeEnv({
      connections: { mongo: { engine: 'mongodb', uri: 'mongodb://h:27017', database: 'doArquivo' } },
    });
    expect(loadEnv({ root, project: 'proj', env: 'dev' }).database).toBe('doArquivo');
  });

  it('should be preferring the database flag over the env file', () => {
    const root = writeEnv({
      connections: { mongo: { engine: 'mongodb', uri: 'mongodb://h:27017', database: 'doArquivo' } },
    });
    expect(loadEnv({ root, project: 'proj', env: 'dev', database: 'daFlag' }).database).toBe('daFlag');
  });

  it('should be applying the database flag to a mysql connection too', () => {
    const root = writeEnv(mysqlEnv);
    expect(loadEnv({ root, project: 'proj', env: 'dev', database: 'outro' }).database).toBe('outro');
  });

  it('should be leaving a mysql database undefined so the uri path stands', () => {
    const root = writeEnv(mysqlEnv);
    expect(loadEnv({ root, project: 'proj', env: 'dev' }).database).toBeUndefined();
  });

  it('should not be leaking the uri password in a validation error', () => {
    const root = writeEnv({ connections: { x: { engine: 'oracle', uri: 'oracle://u:hunter2@h/d' } } });
    try {
      loadEnv({ root, project: 'proj', env: 'dev' });
      expect.unreachable('deveria ter falhado');
    } catch (err) {
      expect((err as DbqError).message).not.toContain('hunter2');
    }
  });
});
