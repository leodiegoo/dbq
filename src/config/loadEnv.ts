import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DbqError, scrubUri } from '../errors.ts';
import { listEnvs } from './resolveProject.ts';
import {
  DEFAULT_LIMIT,
  DEFAULT_TIMEOUT_MS,
  type Connection,
  type EnvConfig,
  type ResolvedConnection,
} from './types.ts';

const usage = (message: string, hint?: string): never => {
  throw new DbqError('USAGE', scrubUri(message), hint);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validateConnection = (name: string, raw: unknown): Connection => {
  if (!isRecord(raw)) return usage(`connection '${name}' must be an object`);

  const uri = raw.uri;
  if (typeof uri !== 'string' || uri.length === 0) usage(`connection '${name}' needs a 'uri'`);

  if (raw.engine === 'mysql') return { engine: 'mysql', uri: uri as string };

  if (raw.engine === 'postgres') {
    const database = raw.database;
    if (database !== undefined && (typeof database !== 'string' || database.length === 0)) {
      usage(`connection '${name}' has an invalid 'database'`, 'use a non-empty string, or omit the field');
    }
    return database === undefined
      ? { engine: 'postgres', uri: uri as string }
      : { engine: 'postgres', uri: uri as string, database: database as string };
  }

  if (raw.engine === 'mongodb') {
    const database = raw.database;
    if (database !== undefined && (typeof database !== 'string' || database.length === 0)) {
      usage(`connection '${name}' has an invalid 'database'`, 'use a non-empty string, or omit the field');
    }
    // `database` is optional: it becomes the connection default, overridden by
    // --database. The database name in the URI path stays ignored either way.
    return database === undefined
      ? { engine: 'mongodb', uri: uri as string }
      : { engine: 'mongodb', uri: uri as string, database: database as string };
  }

  return usage(
    `engine '${String(raw.engine)}' is not supported on connection '${name}'`,
    "use 'mysql', 'postgres' or 'mongodb'",
  );
};

export const loadEnv = (opts: {
  root: string;
  project: string;
  env: string;
  db?: string;
  database?: string;
  limit?: number;
  timeoutMs?: number;
}): ResolvedConnection => {
  const file = join(opts.root, opts.project, `${opts.env}.json`);

  let stat;
  try {
    stat = statSync(file);
  } catch {
    const envs = listEnvs(opts.root, opts.project);
    return usage(
      `env '${opts.env}' not found in ${join(opts.root, opts.project)}. Available: ${envs.join(', ') || '(none)'}`,
    );
  }

  const mode = stat.mode & 0o777;
  if (mode !== 0o600) {
    usage(`${file} has mode ${mode.toString(8).padStart(3, '0')}; expected 600`, `run: chmod 600 ${file}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return usage(`${file} is not valid JSON: ${(err as Error).message}`);
  }

  if (!isRecord(parsed) || !isRecord(parsed.connections)) {
    return usage(`${file} needs a 'connections' object`);
  }

  const config = parsed as EnvConfig;
  const names = Object.keys(config.connections);
  if (names.length === 0) usage(`${file} declares no connections`);

  let selected = opts.db;
  if (selected === undefined) {
    if (names.length > 1) {
      usage(`env '${opts.env}' has several connections: ${names.join(', ')}`, 'pass --db <connection>');
    }
    selected = names[0];
  }

  const rawConnection = config.connections[selected as string];
  if (rawConnection === undefined) {
    usage(`connection '${selected}' does not exist in env '${opts.env}'. Available: ${names.join(', ')}`);
  }

  const connection = validateConnection(selected as string, rawConnection);
  const fileDefaults = config.defaults ?? {};

  return {
    name: selected as string,
    connection,
    database: opts.database ?? (connection.engine === 'mysql' ? undefined : connection.database),
    limit: opts.limit ?? fileDefaults.limit ?? DEFAULT_LIMIT,
    timeoutMs: opts.timeoutMs ?? fileDefaults.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
};
