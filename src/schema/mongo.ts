import { MongoClient } from 'mongodb';
import { DbqError, toConnectionError, toDbqError } from '../errors.ts';
import { listDatabases } from '../engines/mongo.ts';
import type { MongoConnection } from '../config/types.ts';

const SAMPLE_SIZE = 100;

const describe = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  if (typeof value === 'object') {
    const name = (value as { _bsontype?: string })._bsontype;
    return name === undefined ? 'object' : name.toLowerCase();
  }
  return typeof value;
};

export const mongoSchema = async (
  connection: MongoConnection,
  collection: string | undefined,
  opts: { timeoutMs: number; database?: string },
): Promise<unknown[]> => {
  const client = new MongoClient(connection.uri, {
    serverSelectionTimeoutMS: opts.timeoutMs,
    socketTimeoutMS: opts.timeoutMs,
  });

  try {
    await client.connect().catch((err: unknown) => {
      throw toConnectionError(err);
    });
    const database = opts.database ?? connection.database;
    if (database === undefined) {
      const names = await listDatabases(client);
      throw new DbqError(
        'USAGE',
        `nenhum banco definido para esta conexao. Disponiveis: ${names.join(', ') || '(nenhum)'}`,
        'passe --database <nome>, ou declare "database" no arquivo da env',
      );
    }
    const db = client.db(database);

    if (collection === undefined) {
      const collections = await db.listCollections({}, { nameOnly: true }).toArray();
      return collections
        .map((entry) => ({ collection: entry.name }))
        .sort((a, b) => a.collection.localeCompare(b.collection));
    }

    const sample = await db
      .collection(collection)
      .find({}, { maxTimeMS: opts.timeoutMs, limit: SAMPLE_SIZE })
      .toArray();

    const fields = new Map<string, { types: Set<string>; present: number }>();
    for (const document of sample) {
      for (const [key, value] of Object.entries(document)) {
        const entry = fields.get(key) ?? { types: new Set<string>(), present: 0 };
        entry.types.add(describe(value));
        entry.present += 1;
        fields.set(key, entry);
      }
    }

    return [...fields.entries()]
      .map(([field, entry]) => ({
        field,
        types: [...entry.types].sort().join(' | '),
        presence: sample.length === 0 ? '0%' : `${Math.round((entry.present / sample.length) * 100)}%`,
      }))
      .sort((a, b) => a.field.localeCompare(b.field));
  } catch (err) {
    throw toDbqError(err);
  } finally {
    await client.close().catch(() => undefined);
  }
};
