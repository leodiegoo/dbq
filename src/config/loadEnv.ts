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
  if (!isRecord(raw)) return usage(`conexao '${name}' precisa ser um objeto`);

  const uri = raw.uri;
  if (typeof uri !== 'string' || uri.length === 0) usage(`conexao '${name}' precisa de uma 'uri'`);

  if (raw.engine === 'mysql') return { engine: 'mysql', uri: uri as string };

  if (raw.engine === 'mongodb') {
    const database = raw.database;
    if (database !== undefined && (typeof database !== 'string' || database.length === 0)) {
      usage(`conexao '${name}' tem um 'database' invalido`, 'use uma string nao vazia, ou omita o campo');
    }
    // `database` e opcional: vira o default da conexao, sobrescrito por --database.
    // O nome do banco no path da URI segue ignorado nos dois casos.
    return database === undefined
      ? { engine: 'mongodb', uri: uri as string }
      : { engine: 'mongodb', uri: uri as string, database: database as string };
  }

  return usage(`engine '${String(raw.engine)}' nao suportada na conexao '${name}'`, "use 'mysql' ou 'mongodb'");
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
      `env '${opts.env}' nao encontrada em ${join(opts.root, opts.project)}. Disponiveis: ${envs.join(', ') || '(nenhuma)'}`,
    );
  }

  const mode = stat.mode & 0o777;
  if (mode !== 0o600) {
    usage(`${file} esta com permissao ${mode.toString(8).padStart(3, '0')}; esperado 600`, `rode: chmod 600 ${file}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return usage(`${file} nao e um JSON valido: ${(err as Error).message}`);
  }

  if (!isRecord(parsed) || !isRecord(parsed.connections)) {
    return usage(`${file} precisa de um objeto 'connections'`);
  }

  const config = parsed as EnvConfig;
  const names = Object.keys(config.connections);
  if (names.length === 0) usage(`${file} nao declara nenhuma conexao`);

  let selected = opts.db;
  if (selected === undefined) {
    if (names.length > 1) {
      usage(`a env '${opts.env}' tem varias conexoes: ${names.join(', ')}`, 'passe --db <conexao>');
    }
    selected = names[0];
  }

  const rawConnection = config.connections[selected as string];
  if (rawConnection === undefined) {
    usage(`conexao '${selected}' nao existe na env '${opts.env}'. Disponiveis: ${names.join(', ')}`);
  }

  const connection = validateConnection(selected as string, rawConnection);
  const fileDefaults = config.defaults ?? {};

  return {
    name: selected as string,
    connection,
    database: opts.database ?? (connection.engine === 'mongodb' ? connection.database : undefined),
    limit: opts.limit ?? fileDefaults.limit ?? DEFAULT_LIMIT,
    timeoutMs: opts.timeoutMs ?? fileDefaults.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
};
