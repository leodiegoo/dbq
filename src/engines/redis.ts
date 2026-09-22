import { createClient } from 'redis';
import { DbqError, toConnectionError, toDbqError } from '../errors.ts';
import type { RedisConnection } from '../config/types.ts';
import type { RedisPlan } from '../guards/types.ts';
import { applyLimit } from '../output/envelope.ts';
import type { ExecuteResult } from './mysql.ts';

export type RedisExecuteOptions = { limit: number; maxBytes: number; timeoutMs: number };
type RedisExecuteResult = ExecuteResult & { cursor?: string };

const pairs = (values: unknown[], left: string, right: string): unknown[] => {
  const rows: unknown[] = [];
  for (let index = 0; index < values.length; index += 2) {
    rows.push({ [left]: values[index], [right]: values[index + 1] });
  }
  return rows;
};

const values = (reply: unknown): unknown[] => {
  if (reply === null || reply === undefined) return [];
  if (Array.isArray(reply)) return reply.map((value) => ({ value }));
  return [{ value: reply }];
};

const cappedRangeArgs = (plan: RedisPlan, limit: number): string[] => {
  const args = [...plan.args];
  if (limit <= 0) return args;
  const start = Number(args[1]);
  const stop = Number(args[2]);
  if (start >= 0) args[2] = String(stop < 0 ? start + limit : Math.min(stop, start + limit));
  return args;
};

const scanRows = (command: RedisPlan['command'], reply: unknown): { cursor: string; rows: unknown[] } => {
  if (!Array.isArray(reply) || reply.length !== 2 || !Array.isArray(reply[1])) {
    throw new Error(`unexpected ${command} response`);
  }

  const cursor = String(reply[0]);
  const entries = reply[1];
  if (command === 'HSCAN') return { cursor, rows: pairs(entries, 'field', 'value') };
  if (command === 'ZSCAN') return { cursor, rows: pairs(entries, 'value', 'score') };
  return { cursor, rows: entries.map((entry) => ({ [command === 'SCAN' ? 'key' : 'value']: entry })) };
};

export const executeRedis = async (
  connection: RedisConnection,
  plan: RedisPlan,
  opts: RedisExecuteOptions,
): Promise<RedisExecuteResult> => {
  const client = createClient({
    url: connection.uri,
    socket: { connectTimeout: opts.timeoutMs, reconnectStrategy: false },
  });
  client.on('error', () => undefined);

  try {
    await client.connect().catch((err: unknown) => {
      throw toConnectionError(err);
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    const run = (args: string[]): Promise<unknown> =>
      client.withAbortSignal(controller.signal).sendCommand<unknown>(args);

    try {
      if (plan.command === 'GET' && opts.maxBytes > 0) {
        const length = Number(await run(['STRLEN', plan.args[0] as string]));
        const value = await run(['GETRANGE', plan.args[0] as string, '0', String(opts.maxBytes - 1)]);
        if (length === 0 && value === '' && Number(await run(['EXISTS', plan.args[0] as string])) === 0) {
          return { rows: [], truncated: false };
        }
        return { rows: [{ value }], truncated: length > opts.maxBytes };
      }

      if (plan.command.endsWith('SCAN')) {
        const args = [...plan.args];
        const countIndex = args.findIndex((arg) => arg === 'COUNT');
        if (countIndex === -1) args.push('COUNT', String(opts.limit + 1));
        else args[countIndex + 1] = String(Math.min(Number(args[countIndex + 1]), opts.limit + 1));

        const page = scanRows(plan.command, await run([plan.command, ...args]));
        const limited = applyLimit(page.rows, opts.limit);
        return {
          rows: limited.rows,
          truncated: limited.truncated || page.cursor !== '0',
          cursor: page.cursor,
        };
      }

      const args = plan.command === 'LRANGE' || plan.command === 'ZRANGE'
        ? cappedRangeArgs(plan, opts.limit)
        : plan.args;
      const reply = await run([plan.command, ...args]);
      const rows =
        plan.command === 'ZRANGE' && args[3] === 'WITHSCORES'
          ? pairs(reply as unknown[], 'value', 'score')
          : values(reply);
      return applyLimit(rows, opts.limit);
    } catch (err) {
      if (controller.signal.aborted) {
        throw new DbqError('TIMEOUT', 'Redis command timed out', 'narrow the query, or raise --timeout');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const converted = toDbqError(err);
    if (converted.code !== 'UNEXPECTED') throw converted;
    throw new DbqError(
      'DATABASE_ERROR',
      converted.message,
      'check the key type with ["TYPE", "key"] and verify the command arguments',
    );
  } finally {
    if (client.isOpen) client.destroy();
  }
};
