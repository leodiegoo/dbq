import { describe, expect, it } from 'vitest';
import { guardRedis } from '../../src/guards/redis.ts';
import { DbqError } from '../../src/errors.ts';

const refuses = (query: string) => {
  let thrown: unknown;
  try {
    guardRedis(query);
  } catch (err) {
    thrown = err;
  }
  expect(thrown, `should refuse: ${query}`).toBeInstanceOf(DbqError);
  expect((thrown as DbqError).code, `should refuse: ${query}`).toBe('READONLY_VIOLATION');
};

describe('guardRedis — accepted commands', () => {
  it('should be parsing a GET command', () => {
    expect(guardRedis('["GET", "user:42"]')).toEqual({
      kind: 'redis',
      command: 'GET',
      args: ['user:42'],
    });
  });

  it('should be accepting the bounded read command surface', () => {
    for (const query of [
      '["exists", "a", "b"]',
      '["TYPE", "a"]',
      '["TTL", "a"]',
      '["PTTL", "a"]',
      '["STRLEN", "a"]',
      '["HLEN", "h"]',
      '["HEXISTS", "h", "field"]',
      '["LLEN", "list"]',
      '["SCARD", "set"]',
      '["ZCARD", "set"]',
      '["ZSCORE", "set", "member"]',
      '["LRANGE", "list", 0, 20]',
      '["ZRANGE", "set", 0, 20]',
      '["ZRANGE", "set", 0, 20, "WITHSCORES"]',
      '["SCAN", "0", "MATCH", "user:*", "COUNT", 50, "TYPE", "hash"]',
      '["HSCAN", "hash", "0", "MATCH", "a*", "COUNT", 50]',
      '["SSCAN", "set", "0"]',
      '["ZSCAN", "set", "0"]',
    ]) {
      expect(guardRedis(query).kind).toBe('redis');
    }
  });

  it('should be normalizing command names and numeric arguments', () => {
    expect(guardRedis('["lrange", "items", 0, -1]')).toEqual({
      kind: 'redis',
      command: 'LRANGE',
      args: ['items', '0', '-1'],
    });
  });
});

describe('guardRedis — refused commands', () => {
  it('should be refusing writes and dangerous reads', () => {
    for (const query of [
      '["SET", "a", "b"]',
      '["DEL", "a"]',
      '["FLUSHALL"]',
      '["KEYS", "*"]',
      '["EVAL", "return 1", 0]',
      '["EVAL_RO", "return 1", 0]',
      '["FCALL_RO", "f", 0]',
      '["SORT", "items"]',
      '["MULTI"]',
      '["SUBSCRIBE", "events"]',
    ]) {
      refuses(query);
    }
  });

  it('should be refusing malformed JSON commands and arguments', () => {
    for (const query of [
      '',
      '{}',
      '[]',
      '["GET"]',
      '["GET", "a", "b"]',
      '["GET", {"key":"a"}]',
      '["LRANGE", "items", 0.5, 2]',
      '["LRANGE", "items", -10, -1]',
      '["ZRANGE", "items", 0, 2, "STORE"]',
      '["SCAN", "0", "COUNT", 0]',
      '["SCAN", "0", "MATCH"]',
      '["HSCAN", "h"]',
    ]) {
      refuses(query);
    }
  });

  it('should be attaching a hint listing allowed commands', () => {
    try {
      guardRedis('["SET", "a", "b"]');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DbqError).hint).toContain('GET');
      expect((err as DbqError).hint).toContain('SCAN');
    }
  });
});
