#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander';
import { DbqError, toDbqError } from './errors.ts';
import { configRoot, listEnvs, listProjects, resolveProject } from './config/resolveProject.ts';
import { loadEnv } from './config/loadEnv.ts';
import { guardSql } from './guards/sql.ts';
import { guardPostgres } from './guards/postgres.ts';
import { guardMongo } from './guards/mongo.ts';
import { executeMysql } from './engines/mysql.ts';
import { executeMongo } from './engines/mongo.ts';
import { executePostgres } from './engines/postgres.ts';
import { mysqlSchema } from './schema/mysql.ts';
import { mongoSchema } from './schema/mongo.ts';
import { postgresDatabases, postgresSchema } from './schema/postgres.ts';
import { listDatabases } from './engines/mongo.ts';
import { MongoClient } from 'mongodb';
import { formatError, formatJson, formatTable, type Envelope } from './output/envelope.ts';

type Format = 'json' | 'table';

type CommonOptions = {
  project?: string;
  env: string;
  db?: string;
  database?: string;
  limit?: number;
  timeout?: number;
  format: Format;
  explain?: boolean;
};

const integer = (raw: string): number => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new InvalidArgumentError('expected a non-negative integer');
  return value;
};

const format = (raw: string): Format => {
  if (raw !== 'json' && raw !== 'table') throw new InvalidArgumentError("expected 'json' or 'table'");
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
    timeoutMs: opts.timeout,
  });
  return { project, resolved };
};

const emit = (envelope: Envelope, output: Format): void => {
  const color = output === 'table' && process.stdout.isTTY === true;
  process.stdout.write(`${output === 'json' ? formatJson(envelope) : formatTable(envelope, color)}\n`);
};

const fail = (err: unknown, output: Format): never => {
  const dbqError = toDbqError(err);
  process.stderr.write(`${formatError(dbqError, output)}\n`);
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

program.name('dbq').description('Read-only query runner for SQL and MongoDB').version('0.1.0');

const withCommonOptions = (command: Command): Command =>
  command
    .option('-p, --project <name>', 'project under ~/.config/dbq (default: inferred from cwd)')
    .requiredOption('-e, --env <name>', 'environment to use')
    .option('-d, --db <connection>', 'connection inside the env (required when there is more than one)')
    .option('-D, --database <name>', 'database to query; overrides the env file')
    .option('-t, --timeout <ms>', 'statement timeout', integer)
    .option('-f, --format <format>', 'json or table', format, 'json');

// Default subcommand: `dbq "SELECT 1"` lands here, while `dbq envs` and
// `dbq schema` are still routed by name. The common options must live on the
// subcommand — on the root program Commander would demand them from all.
withCommonOptions(
  program
    .command('run', { isDefault: true })
    .description('run a read query (default command)')
    .argument('<query>', "SQL query, a db.<collection>.<op>(...) expression, or '-' to read stdin")
    .option('-l, --limit <n>', 'ceiling on returned rows; 0 disables it', integer)
    .option('-x, --explain', 'run EXPLAIN / .explain() instead of the query'),
).action(async (query: string, opts: CommonOptions) => {
  try {
    const raw = query === '-' ? await readStdin() : query;
    rejectSubcommandAsQuery(raw);
    const { project, resolved } = resolve(opts);
    const { connection } = resolved;
    const started = Date.now();

    const engineOptions = {
      limit: resolved.limit,
      timeoutMs: resolved.timeoutMs,
      explain: opts.explain === true,
      database: resolved.database,
    };

    const { rows, truncated } =
      connection.engine === 'mysql'
        ? await executeMysql(connection, guardSql(raw), engineOptions)
        : connection.engine === 'postgres'
          ? await executePostgres(connection, guardPostgres(raw), engineOptions)
          : await executeMongo(connection, guardMongo(raw), engineOptions);

    emit(
      {
        project,
        env: opts.env,
        db: resolved.name,
        engine: connection.engine,
        rowCount: rows.length,
        truncated,
        elapsedMs: Date.now() - started,
        rows,
      },
      opts.format,
    );
  } catch (err) {
    fail(err, opts.format);
  }
});

program
  .command('envs')
  .description('list configured projects and environments')
  .option('-f, --format <format>', 'json or table', format, 'json')
  .action((opts: { format: Format }) => {
    try {
      const root = configRoot();
      const rows = listProjects(root).flatMap((project) =>
        listEnvs(root, project).map((env) => ({ project, env })),
      );

      if (opts.format === 'json') {
        process.stdout.write(`${JSON.stringify({ root, rows }, null, 2)}\n`);
        return;
      }

      process.stdout.write(`${root}\n${rows.map((row) => `  ${row.project}/${row.env}`).join('\n')}\n`);
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

    const schemaOptions = { timeoutMs: resolved.timeoutMs, database: resolved.database };
    const rows =
      connection.engine === 'mysql'
        ? await mysqlSchema(connection, target, schemaOptions)
        : connection.engine === 'postgres'
          ? await postgresSchema(connection, target, schemaOptions)
          : await mongoSchema(connection, target, schemaOptions);

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
