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
import { formatError, formatTable, formatToon, formatToonValue, formatValueTable, truncateContent, type Envelope } from './output/envelope.ts';

type Format = 'table' | 'toon';

type CommonOptions = {
  project?: string;
  env: string;
  db?: string;
  database?: string;
  limit?: number;
  maxBytes?: number;
  timeout?: number;
  format: Format;
  full?: boolean;
  explain?: boolean;
};

const integer = (raw: string): number => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new InvalidArgumentError('expected a non-negative integer');
  return value;
};

const format = (raw: string): Format => {
  if (raw !== 'table' && raw !== 'toon') {
    throw new InvalidArgumentError("expected 'toon' or 'table'");
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

const emit = (envelope: Envelope, output: Format, full = false): void => {
  const color = output === 'table' && process.stdout.isTTY === true;
  const limited = truncateContent(envelope, full).value as Envelope;
  const rendered = output === 'table' ? formatTable(limited, color) : formatToon(limited);
  process.stdout.write(`${rendered}\n`);
};

const fail = (err: unknown): never => {
  const dbqError = toDbqError(err);
  process.stdout.write(`${formatError(dbqError)}\n`);
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

const handleCliError = (err: { code: string; message: string; exitCode: number }): never => {
  if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') process.exit(0);
  const usageError = new DbqError('USAGE', err.message, 'run `dbq --help` for valid commands and flags');
  process.stdout.write(`${formatError(usageError)}\n`);
  process.exit(2);
};

const configureErrors = (command: Command): Command =>
  command.configureOutput({ writeErr: () => undefined }).exitOverride(handleCliError);

const withCommonOptions = (command: Command): Command =>
  configureErrors(command)
    .option('-p, --project <name>', 'project under ~/.config/dbq (default: inferred from cwd)')
    .requiredOption('-e, --env <name>', 'environment to use')
    .option('-d, --db <connection>', 'connection inside the env (required when there is more than one)')
    .option('-D, --database <name>', 'database to query; overrides the env file')
    .option('-t, --timeout <ms>', 'statement timeout (default: 30000)', integer)
    .option('-f, --format <format>', 'toon or table', format, 'toon')
    .option('--full', 'bypass text-field truncation; row and Redis byte limits still apply');

// Default subcommand: `dbq "SELECT 1"` lands here, while `dbq envs` and
// `dbq schema` are still routed by name. The common options must live on the
// subcommand — on the root program Commander would demand them from all.
withCommonOptions(
  program
    .command('run', { isDefault: true })
    .description('run a read query (default command)')
    .argument('<query>', "SQL, db.<collection>.<op>(...), a Redis JSON command, or '-' to read stdin")
    .option('-l, --limit <n>', 'row/item ceiling; 0 disables it for SQL and MongoDB (default: 500)', integer)
    .option('--max-bytes <n>', 'Redis GET byte ceiling; 0 disables it (default: 1000000)', integer)
    .option('-x, --explain', 'run EXPLAIN / .explain() instead of the query'),
).addHelpText('after', `
Examples:
  dbq run --env <env> "SELECT id, name FROM companies"
  dbq run --env <env> --db <mongo> 'db.companies.find({ active: true }).limit(10)'
  dbq run --env <env> --db <cache> '["SCAN","0","MATCH","cache:*"]'
`).action(async (query: string, opts: CommonOptions) => {
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
      opts.format,
      opts.full === true,
    );
  } catch (err) {
    fail(err);
  }
});

configureErrors(program
  .command('envs')
  .description('list configured projects and environments')
  .option('-f, --format <format>', 'toon or table', format, 'toon')
  .addHelpText('after', `
Examples:
  dbq envs
  dbq envs --format table
`))
  .action((opts: { format: Format }) => {
    try {
      const root = configRoot();
      const rows = listProjects(root).flatMap((project) =>
        listEnvs(root, project).map((env) => ({ project, env })),
      );

      const value = { root, rows };
      process.stdout.write(`${opts.format === 'table' ? formatValueTable(value, process.stdout.isTTY === true) : formatToonValue(value)}\n`);
    } catch (err) {
      fail(err);
    }
  });

withCommonOptions(
  program
    .command('schema')
    .description('list tables/collections, or detail one of them')
    .argument('[target]', 'table or collection name'),
).addHelpText('after', `
Examples:
  dbq schema --env <env> --db <connection>
  dbq schema --env <env> --db <connection> <table-or-collection>
`).action(async (target: string | undefined, opts: CommonOptions) => {
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
      opts.format,
      opts.full === true,
    );
  } catch (err) {
    fail(err);
  }
});

withCommonOptions(
  program.command('databases').description('list the databases available on the connection'),
).addHelpText('after', `
Examples:
  dbq databases --env <env> --db <connection>
  dbq databases --project <project> --env <env> --db <connection>
`).action(async (opts: CommonOptions) => {
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
      opts.format,
      opts.full === true,
    );
  } catch (err) {
    fail(err);
  }
});

// Commander exits with 1 on usage errors; the spec reserves 2 for that.
configureErrors(program);

try {
  await program.parseAsync();
} catch (err) {
  if (err instanceof DbqError) fail(err);
  throw err;
}
