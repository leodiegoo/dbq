#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander';
import { DbqError, toDbqError } from './errors.ts';
import { configRoot, listEnvs, listProjects, resolveProject } from './config/resolveProject.ts';
import { loadEnv } from './config/loadEnv.ts';
import { guardSql } from './guards/sql.ts';
import { guardPostgres } from './guards/postgres.ts';
import { guardMongo } from './guards/mongo.ts';
import { guardRedis } from './guards/redis.ts';
import { executeMysql } from './engines/mysql.ts';
import { executeMongo } from './engines/mongo.ts';
import { executePostgres } from './engines/postgres.ts';
import { executeRedis } from './engines/redis.ts';
import { mysqlSchema } from './schema/mysql.ts';
import { mongoSchema } from './schema/mongo.ts';
import { postgresDatabases, postgresSchema } from './schema/postgres.ts';
import { listDatabases } from './engines/mongo.ts';
import { MongoClient } from 'mongodb';
import { formatError, formatJson, formatJsonValue, formatTable, formatToon, formatToonValue, type Envelope } from './output/envelope.ts';

type Format = 'json' | 'table' | 'toon';

type CommonOptions = {
  project?: string;
  env: string;
  db?: string;
  database?: string;
  limit?: number;
  maxBytes?: number;
  timeout?: number;
  format: Format;
  json?: boolean;
  explain?: boolean;
};

const integer = (raw: string): number => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new InvalidArgumentError('expected a non-negative integer');
  return value;
};

const format = (raw: string): Format => {
  if (raw !== 'json' && raw !== 'table' && raw !== 'toon') {
    throw new InvalidArgumentError("expected 'toon', 'json' or 'table'");
  }
  return raw;
};

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
};

const resolve = (opts: CommonOptions) => {
  const root = configRoot();
  const project = resolveProject({ explicit: opts.project, cwd: process.cwd(), root });
  const resolved = loadEnv({
    root,
    project,
    env: opts.env,
    db: opts.db,
    database: opts.database,
    limit: opts.limit,
    maxBytes: opts.maxBytes,
    timeoutMs: opts.timeout,
  });
  return { project, resolved };
};

const emit = (envelope: Envelope, output: Format): void => {
  const color = output === 'table' && process.stdout.isTTY === true;
  const rendered = output === 'json' ? formatJson(envelope) : output === 'table' ? formatTable(envelope, color) : formatToon(envelope);
  process.stdout.write(`${rendered}\n`);
};

const fail = (err: unknown, output: Format): never => {
  const dbqError = toDbqError(err);
  process.stderr.write(`${formatError(dbqError, output === 'table' ? 'table' : 'json')}\n`);
  process.exit(dbqError.exitCode);
};

const SUBCOMMANDS = ['run', 'envs', 'schema', 'databases'];

/**
 * `dbq -e dev -d mysql schema` sends the word `schema` as the query: Commander
 * only recognises a subcommand when it comes before the flags. Refusing with
 * the corrected invocation beats reordering argv ourselves, which would break
 * for anyone with a connection named `schema`.
 */
const rejectSubcommandAsQuery = (raw: string): void => {
  const word = raw.trim();
  if (!SUBCOMMANDS.includes(word)) return;
  throw new DbqError(
    'USAGE',
    `'${word}' is a subcommand, not a query`,
    `the subcommand comes before the flags: dbq ${word} -e <env> [-d <connection>]`,
  );
};

const program = new Command();

program.name('dbq').description('Read-only query runner for SQL, MongoDB and Redis').version('0.1.0');

const withCommonOptions = (command: Command): Command =>
  command
    .option('-p, --project <name>', 'project under ~/.config/dbq (default: inferred from cwd)')
    .requiredOption('-e, --env <name>', 'environment to use')
    .option('-d, --db <connection>', 'connection inside the env (required when there is more than one)')
    .option('-D, --database <name>', 'database to query; overrides the env file')
    .option('-t, --timeout <ms>', 'statement timeout', integer)
    .option('-f, --format <format>', 'toon, json or table', format, 'toon')
    .option('--json', 'emit JSON for compatibility');

// Default subcommand: `dbq "SELECT 1"` lands here, while `dbq envs` and
// `dbq schema` are still routed by name. The common options must live on the
// subcommand — on the root program Commander would demand them from all.
withCommonOptions(
  program
    .command('run', { isDefault: true })
    .description('run a read query (default command)')
    .argument('<query>', "SQL, db.<collection>.<op>(...), a Redis JSON command, or '-' to read stdin")
    .option('-l, --limit <n>', 'ceiling on returned rows; 0 disables it', integer)
    .option('--max-bytes <n>', 'Redis string-value ceiling', integer)
    .option('-x, --explain', 'run EXPLAIN / .explain() instead of the query'),
).action(async (query: string, opts: CommonOptions) => {
  try {
    const raw = query === '-' ? await readStdin() : query;
    rejectSubcommandAsQuery(raw);
    const { project, resolved } = resolve(opts);
    const { connection } = resolved;
    if (connection.engine === 'redis' && opts.explain === true) {
      throw new DbqError('USAGE', '--explain is not supported for Redis');
    }
    if (connection.engine === 'redis' && resolved.limit === 0) {
      throw new DbqError('USAGE', '--limit 0 is not supported for Redis', 'use a positive result ceiling');
    }
    const started = Date.now();

    const engineOptions = {
      limit: resolved.limit,
      maxBytes: resolved.maxBytes,
      timeoutMs: resolved.timeoutMs,
      explain: opts.explain === true,
      database: resolved.database,
    };

    let result;
    if (connection.engine === 'mysql') result = await executeMysql(connection, guardSql(raw), engineOptions);
    else if (connection.engine === 'postgres') {
      result = await executePostgres(connection, guardPostgres(raw), engineOptions);
    } else if (connection.engine === 'mongodb') {
      result = await executeMongo(connection, guardMongo(raw), engineOptions);
    } else {
      result = await executeRedis(connection, guardRedis(raw), engineOptions);
    }
    const { rows, truncated } = result;
    const cursor = connection.engine === 'redis' ? (result as { cursor?: string }).cursor : undefined;

    emit(
      {
        project,
        env: opts.env,
        db: resolved.name,
        engine: connection.engine,
        rowCount: rows.length,
        truncated,
        ...(cursor === undefined ? {} : { cursor }),
        elapsedMs: Date.now() - started,
        rows,
      },
      opts.json === true ? 'json' : opts.format,
    );
  } catch (err) {
    fail(err, opts.format);
  }
});

program
  .command('envs')
  .description('list configured projects and environments')
  .option('-f, --format <format>', 'toon, json or table', format, 'toon')
  .option('--json', 'emit JSON for compatibility')
  .action((opts: { format: Format; json?: boolean }) => {
    try {
      const root = configRoot();
      const rows = listProjects(root).flatMap((project) =>
        listEnvs(root, project).map((env) => ({ project, env })),
      );

      if (opts.json === true || opts.format === 'json') {
        process.stdout.write(`${formatJsonValue({ root, rows })}\n`);
        return;
      }

      process.stdout.write(`${formatToonValue({ root, rows })}\n`);
    } catch (err) {
      fail(err, opts.format);
    }
  });

withCommonOptions(
  program
    .command('schema')
    .description('list tables/collections, or detail one of them')
    .argument('[target]', 'table or collection name'),
).action(async (target: string | undefined, opts: CommonOptions) => {
  try {
    const { project, resolved } = resolve(opts);
    const { connection } = resolved;
    const started = Date.now();

    if (connection.engine === 'redis') {
      throw new DbqError('USAGE', 'schema is not supported for Redis', 'use SCAN with a narrow MATCH pattern');
    }

    const schemaOptions = { timeoutMs: resolved.timeoutMs, database: resolved.database };
    let rows;
    if (connection.engine === 'mysql') rows = await mysqlSchema(connection, target, schemaOptions);
    else if (connection.engine === 'postgres') rows = await postgresSchema(connection, target, schemaOptions);
    else rows = await mongoSchema(connection, target, schemaOptions);

    emit(
      {
        project,
        env: opts.env,
        db: resolved.name,
        engine: connection.engine,
        rowCount: rows.length,
        truncated: false,
        elapsedMs: Date.now() - started,
        rows,
      },
      opts.json === true ? 'json' : opts.format,
    );
  } catch (err) {
    fail(err, opts.format);
  }
});

withCommonOptions(
  program.command('databases').description('list the databases available on the connection'),
).action(async (opts: CommonOptions) => {
  try {
    const { project, resolved } = resolve(opts);
    const { connection } = resolved;
    const started = Date.now();

    let rows: unknown[];
    if (connection.engine === 'mysql') {
      const result = await executeMysql(
        connection,
        { kind: 'sql', statement: 'SHOW DATABASES' },
        { limit: 0, timeoutMs: resolved.timeoutMs, explain: false },
      );
      rows = result.rows;
    } else if (connection.engine === 'postgres') {
      rows = await postgresDatabases(connection, { timeoutMs: resolved.timeoutMs });
    } else if (connection.engine === 'redis') {
      throw new DbqError('USAGE', 'databases is not supported for Redis', 'put the logical database number in the Redis URI path');
    } else {
      const client = new MongoClient(connection.uri, {
        serverSelectionTimeoutMS: resolved.timeoutMs,
        socketTimeoutMS: resolved.timeoutMs,
      });
      try {
        await client.connect();
        rows = (await listDatabases(client)).map((database) => ({ database }));
      } finally {
        await client.close().catch(() => undefined);
      }
    }

    emit(
      {
        project,
        env: opts.env,
        db: resolved.name,
        engine: connection.engine,
        rowCount: rows.length,
        truncated: false,
        elapsedMs: Date.now() - started,
        rows,
      },
      opts.json === true ? 'json' : opts.format,
    );
  } catch (err) {
    fail(err, opts.format);
  }
});

// Commander exits with 1 on usage errors; the spec reserves 2 for that.
program.exitOverride((err) => {
  if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') process.exit(0);
  process.exit(err.exitCode === 0 ? 0 : 2);
});

try {
  await program.parseAsync();
} catch (err) {
  if (err instanceof DbqError) fail(err, 'json');
  throw err;
}
