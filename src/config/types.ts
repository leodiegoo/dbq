export const DEFAULT_LIMIT = 500;
export const DEFAULT_TIMEOUT_MS = 30_000;

export type MysqlConnection = { engine: 'mysql'; uri: string };
export type PostgresConnection = { engine: 'postgres'; uri: string; database?: string };
export type MongoConnection = { engine: 'mongodb'; uri: string; database?: string };
export type Connection = MysqlConnection | PostgresConnection | MongoConnection;

export type EnvConfig = {
  connections: Record<string, Connection>;
  defaults?: { limit?: number; timeoutMs?: number };
};

export type ResolvedConnection = {
  name: string;
  connection: Connection;
  /** Flag > env file field > undefined (MySQL falls back to the URI path; Mongo fails and lists). */
  database: string | undefined;
  limit: number;
  timeoutMs: number;
};
