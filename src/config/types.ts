export const DEFAULT_LIMIT = 500;
export const DEFAULT_TIMEOUT_MS = 30_000;

export type MysqlConnection = { engine: 'mysql'; uri: string };
export type MongoConnection = { engine: 'mongodb'; uri: string; database: string };
export type Connection = MysqlConnection | MongoConnection;

export type EnvConfig = {
  connections: Record<string, Connection>;
  defaults?: { limit?: number; timeoutMs?: number };
};

export type ResolvedConnection = {
  name: string;
  connection: Connection;
  limit: number;
  timeoutMs: number;
};
