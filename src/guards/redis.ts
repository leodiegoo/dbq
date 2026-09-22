import { DbqError } from '../errors.ts';
import { REDIS_READ_COMMANDS, type RedisPlan, type RedisReadCommand } from './types.ts';

const HINT = `read commands: ${REDIS_READ_COMMANDS.join(', ')}`;
const SIMPLE_ARITY: Partial<Record<RedisReadCommand, readonly [number, number]>> = {
  GET: [1, 1],
  EXISTS: [1, Number.POSITIVE_INFINITY],
  TYPE: [1, 1],
  TTL: [1, 1],
  PTTL: [1, 1],
  STRLEN: [1, 1],
  HLEN: [1, 1],
  HEXISTS: [2, 2],
  LLEN: [1, 1],
  SCARD: [1, 1],
  ZCARD: [1, 1],
  ZSCORE: [2, 2],
};

const refuse = (reason: string): never => {
  throw new DbqError('READONLY_VIOLATION', reason, HINT);
};

const isInteger = (value: string): boolean => /^-?\d+$/.test(value);
const isCursor = (value: string): boolean => /^\d+$/.test(value);

const validateScan = (command: RedisReadCommand, args: string[]): void => {
  const cursorIndex = command === 'SCAN' ? 0 : 1;
  if (args.length <= cursorIndex || !isCursor(args[cursorIndex] as string)) {
    refuse(`${command} requires a non-negative integer cursor`);
  }
  if (command !== 'SCAN' && args[0]?.length === 0) refuse(`${command} requires a key`);

  const allowed = command === 'SCAN' ? new Set(['MATCH', 'COUNT', 'TYPE']) : new Set(['MATCH', 'COUNT']);
  for (let index = cursorIndex + 1; index < args.length; index += 2) {
    const option = args[index]?.toUpperCase() ?? '';
    const value = args[index + 1];
    if (!allowed.has(option) || value === undefined) refuse(`${command} has invalid options`);
    if (option === 'COUNT' && (!isCursor(value as string) || value === '0')) {
      refuse(`${command} COUNT must be positive`);
    }
    args[index] = option;
  }
};

export const guardRedis = (raw: string): RedisPlan => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return refuse('Redis query must be a JSON array');
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || typeof parsed[0] !== 'string') {
    return refuse('Redis query must be a non-empty JSON array beginning with a command');
  }
  if (parsed.slice(1).some((value) => typeof value !== 'string' && !Number.isInteger(value))) {
    return refuse('Redis command arguments must be strings or integers');
  }

  const command = parsed[0].toUpperCase();
  if (!REDIS_READ_COMMANDS.includes(command as RedisReadCommand)) {
    return refuse(`command '${parsed[0]}' is not allowed`);
  }

  const readCommand = command as RedisReadCommand;
  const args = parsed.slice(1).map(String);
  const arity = SIMPLE_ARITY[readCommand];
  if (arity !== undefined && (args.length < arity[0] || args.length > arity[1])) {
    refuse(`${readCommand} received the wrong number of arguments`);
  }

  if (readCommand === 'LRANGE' || readCommand === 'ZRANGE') {
    const expected = readCommand === 'ZRANGE' && args[3]?.toUpperCase() === 'WITHSCORES' ? 4 : 3;
    if (
      args.length !== expected ||
      !isCursor(args[1] as string) ||
      !isInteger(args[2] as string)
    ) {
      refuse(`${readCommand} expects a key, non-negative start and integer stop${readCommand === 'ZRANGE' ? ', optionally WITHSCORES' : ''}`);
    }
    if (args[3] !== undefined) args[3] = 'WITHSCORES';
  }

  if (readCommand.endsWith('SCAN')) validateScan(readCommand, args);

  return { kind: 'redis', command: readCommand, args };
};
