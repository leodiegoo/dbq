import { MongoClient, type Document } from 'mongodb';
import { DbqError, toConnectionError, toDbqError } from '../errors.ts';
import type { MongoConnection } from '../config/types.ts';
import type { MongoPlan } from '../guards/types.ts';
import { applyLimit } from '../output/envelope.ts';
import type { ExecuteOptions, ExecuteResult } from './mysql.ts';

const INTERNAL_DATABASES = ['admin', 'config', 'local'];

export const listDatabases = async (client: MongoClient): Promise<string[]> => {
  const { databases } = await client.db().admin().listDatabases({ nameOnly: true });
  return databases.map((entry) => entry.name).filter((name) => !INTERNAL_DATABASES.includes(name));
};

/**
 * With no database resolved there is no query to build. The error lists the
 * cluster's databases so that re-invoking with --database is immediate, the
 * same way the project error lists the projects.
 */
const requireDatabase = async (client: MongoClient, database: string | undefined): Promise<string> => {
  if (database !== undefined) return database;
  const names = await listDatabases(client);
  throw new DbqError(
    'USAGE',
    `no database defined for this connection. Available: ${names.join(', ') || '(none)'}`,
    'pass --database <name>, or declare "database" in the env file',
  );
};

/** The dbq ceiling is an upper bound: a query already asking for less still wins. */
const ceiling = (requested: number | undefined, cap: number): number => {
  if (cap <= 0) return requested ?? 0;
  if (requested === undefined) return cap + 1;
  return Math.min(requested, cap + 1);
};

export const executeMongo = async (
  connection: MongoConnection,
  plan: MongoPlan,
  opts: ExecuteOptions,
): Promise<ExecuteResult> => {
  const client = new MongoClient(connection.uri, {
    serverSelectionTimeoutMS: opts.timeoutMs,
    socketTimeoutMS: opts.timeoutMs,
  });

  try {
    await client.connect().catch((err: unknown) => {
      throw toConnectionError(err);
    });
    const database = await requireDatabase(client, opts.database);
    const collection = client.db(database).collection(plan.collection);
    const [first, second] = plan.args;
    const { limit, sort, skip, project } = plan.modifiers;
    const fetch = ceiling(limit, opts.limit);

    const rows = await (async (): Promise<unknown[]> => {
      switch (plan.operation) {
        case 'find': {
          let cursor = collection.find((first ?? {}) as Document, { maxTimeMS: opts.timeoutMs });
          const projection = (project ?? second) as Document | undefined;
          if (projection !== undefined) cursor = cursor.project(projection);
          if (sort !== undefined) cursor = cursor.sort(sort as Document);
          if (skip !== undefined) cursor = cursor.skip(skip);
          if (fetch > 0) cursor = cursor.limit(fetch);
          if (opts.explain) return [await cursor.explain()];
          return await cursor.toArray();
        }

        case 'findOne': {
          const projection = (project ?? second) as Document | undefined;
          const document = await collection.findOne((first ?? {}) as Document, {
            maxTimeMS: opts.timeoutMs,
            ...(projection === undefined ? {} : { projection }),
          });
          return document === null ? [] : [document];
        }

        case 'aggregate': {
          const stages = [...((first ?? []) as Document[])];
          if (skip !== undefined) stages.push({ $skip: skip });
          if (sort !== undefined) stages.push({ $sort: sort as Document });
          if (fetch > 0) stages.push({ $limit: fetch });
          const cursor = collection.aggregate(stages, { maxTimeMS: opts.timeoutMs });
          if (opts.explain) return [await cursor.explain()];
          return await cursor.toArray();
        }

        case 'countDocuments':
          return [
            { count: await collection.countDocuments((first ?? {}) as Document, { maxTimeMS: opts.timeoutMs }) },
          ];

        case 'estimatedDocumentCount':
          return [{ count: await collection.estimatedDocumentCount({ maxTimeMS: opts.timeoutMs }) }];

        case 'distinct': {
          const values = await collection.distinct(String(first ?? ''), (second ?? {}) as Document, {
            maxTimeMS: opts.timeoutMs,
          });
          return values.map((value) => ({ value }));
        }
      }
    })();

    if (opts.explain) return { rows, truncated: false };
    return applyLimit(rows, opts.limit);
  } catch (err) {
    throw toDbqError(err);
  } finally {
    await client.close().catch(() => undefined);
  }
};
