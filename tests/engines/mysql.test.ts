import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type FakeClient = EventEmitter & {
  threadId: number;
  sqls: string[];
  destroy: ReturnType<typeof vi.fn>;
  end: (cb?: () => void) => void;
  connect: (cb: (err: Error | null) => void) => void;
  query: (arg: unknown, cb?: (err: Error | null) => void) => unknown;
};

const created: FakeClient[] = [];
let queryBehaviour: (stream: EventEmitter) => void = () => undefined;
let killError: (Error & { errno?: number }) | undefined;

vi.mock('mysql2', () => ({
  createConnection: () => {
    const index = created.length;
    const client = Object.assign(new EventEmitter(), {
      threadId: 100 + index,
      sqls: [] as string[],
      destroy: vi.fn(),
      end: (cb?: () => void) => cb?.(),
      connect: (cb: (err: Error | null) => void) => cb(null),
      query: (arg: { sql: string }, cb?: (err: Error | null) => void) => {
        client.sqls.push(arg.sql);
        if (cb) return cb(killError ?? null);
        const stream = new EventEmitter();
        queryBehaviour(stream);
        return stream;
      },
    }) as FakeClient;
    created.push(client);
    return client;
  },
}));

const { executeMysql } = await import('../../src/engines/mysql.ts');

const connection = { engine: 'mysql', uri: 'mysql://u:secret@host/db' } as never;
const plan = { statement: 'SELECT 1' } as never;
const opts = { limit: 2, timeoutMs: 1000, explain: false };
const kills = () => created.slice(1).flatMap((c) => c.sqls);

beforeEach(() => {
  created.length = 0;
  killError = undefined;
});

describe('executeMysql server-side kill', () => {
  it('should be KILL QUERY on a side connection with the main threadId when the timeout fires', async () => {
    queryBehaviour = (stream) =>
      setImmediate(() =>
        stream.emit('error', Object.assign(new Error('timeout'), { code: 'PROTOCOL_SEQUENCE_TIMEOUT', fatal: true })),
      );

    await expect(executeMysql(connection, plan, opts)).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(created[0]!.sqls).toEqual(['SELECT 1']);
    expect(kills()).toEqual(['KILL QUERY 100']);
  });

  it('should be KILL QUERY when the row ceiling stops consuming the stream', async () => {
    queryBehaviour = (stream) =>
      setImmediate(() => {
        for (const n of [1, 2, 3]) stream.emit('result', { n });
      });

    const result = await executeMysql(connection, plan, opts);
    expect(result.truncated).toBe(true);
    expect(kills()).toEqual(['KILL QUERY 100']);
    expect(created[0]!.destroy).toHaveBeenCalled();
  });

  it('should be no KILL when the query ends normally', async () => {
    queryBehaviour = (stream) =>
      setImmediate(() => {
        stream.emit('result', { n: 1 });
        stream.emit('end');
      });

    await executeMysql(connection, plan, opts);
    expect(created).toHaveLength(1);
  });

  it('should be no KILL when the server itself rejected the statement', async () => {
    queryBehaviour = (stream) =>
      setImmediate(() => stream.emit('error', Object.assign(new Error('syntax'), { code: 'ER_PARSE_ERROR', sqlState: '42000' })));

    await expect(executeMysql(connection, plan, opts)).rejects.toMatchObject({ code: 'DATABASE_ERROR' });
    expect(created).toHaveLength(1);
  });

  it('should be the original error plus a warning without credentials when the KILL fails', async () => {
    queryBehaviour = (stream) =>
      setImmediate(() => stream.emit('error', Object.assign(new Error('timeout'), { code: 'PROTOCOL_SEQUENCE_TIMEOUT' })));
    killError = Object.assign(new Error('denied for mysql://u:secret@host/db'), { errno: 1227 });

    const err = await executeMysql(connection, plan, opts).catch((e: Error) => e);
    expect(err).toMatchObject({ code: 'TIMEOUT' });
    expect((err as Error).message).toContain('timeout');
    expect((err as Error).message).toContain('could not stop the query on the server (thread 100)');
    expect((err as Error).message).not.toContain('secret');
  });
});
