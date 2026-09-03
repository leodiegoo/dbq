#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander';
import { DbqError, toDbqError } from './errors.ts';
import { configRoot, listEnvs, listProjects, resolveProject } from './config/resolveProject.ts';
import { loadEnv } from './config/loadEnv.ts';
import { guardSql } from './guards/sql.ts';
import { guardMongo } from './guards/mongo.ts';
import { executeMysql } from './engines/mysql.ts';
import { executeMongo } from './engines/mongo.ts';
import { mysqlSchema } from './schema/mysql.ts';
import { mongoSchema } from './schema/mongo.ts';
import { formatError, formatJson, formatTable, type Envelope } from './output/envelope.ts';

type Format = 'json' | 'table';

type CommonOptions = {
  project?: string;
  env: string;
  db?: string;
  limit?: number;
  timeout?: number;
  format: Format;
  explain?: boolean;
};

const integer = (raw: string): number => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new InvalidArgumentError('esperado um inteiro nao negativo');
  return value;
};

const format = (raw: string): Format => {
  if (raw !== 'json' && raw !== 'table') throw new InvalidArgumentError("esperado 'json' ou 'table'");
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

const program = new Command();

program.name('dbq').description('Executor read-only de queries SQL e MongoDB').version('0.1.0');

const withCommonOptions = (command: Command): Command =>
  command
    .option('-p, --project <nome>', 'projeto em ~/.config/dbq (default: inferido do cwd)')
    .requiredOption('-e, --env <nome>', 'ambiente a usar')
    .option('-d, --db <conexao>', 'conexao dentro da env (obrigatorio se houver mais de uma)')
    .option('-t, --timeout <ms>', 'timeout do statement', integer)
    .option('-f, --format <formato>', 'json ou table', format, 'json');

// Subcomando default: `dbq "SELECT 1"` cai aqui, mas `dbq envs` e `dbq schema`
// continuam sendo roteados pelo nome. As opcoes comuns precisam viver no
// subcomando — no programa raiz, o Commander as cobraria de todos eles.
withCommonOptions(
  program
    .command('run', { isDefault: true })
    .description('executa uma query de leitura (comando default)')
    .argument('<query>', "query SQL, expressao db.<colecao>.<op>(...), ou '-' para ler do stdin")
    .option('-l, --limit <n>', 'teto de linhas retornadas; 0 desliga', integer)
    .option('-x, --explain', 'roda EXPLAIN / .explain() em vez da query'),
).action(async (query: string, opts: CommonOptions) => {
  try {
    const raw = query === '-' ? await readStdin() : query;
    const { project, resolved } = resolve(opts);
    const { connection } = resolved;
    const started = Date.now();

    const execute =
      connection.engine === 'mysql'
        ? executeMysql(connection, guardSql(raw), {
            limit: resolved.limit,
            timeoutMs: resolved.timeoutMs,
            explain: opts.explain === true,
          })
        : executeMongo(connection, guardMongo(raw), {
            limit: resolved.limit,
            timeoutMs: resolved.timeoutMs,
            explain: opts.explain === true,
          });

    const { rows, truncated } = await execute;

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
  .description('lista projetos e ambientes configurados')
  .option('-f, --format <formato>', 'json ou table', format, 'json')
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
    .description('lista tabelas/colecoes, ou o detalhe de uma delas')
    .argument('[alvo]', 'nome da tabela ou colecao'),
).action(async (alvo: string | undefined, opts: CommonOptions) => {
  try {
    const { project, resolved } = resolve(opts);
    const { connection } = resolved;
    const started = Date.now();

    const rows =
      connection.engine === 'mysql'
        ? await mysqlSchema(connection, alvo, { timeoutMs: resolved.timeoutMs })
        : await mongoSchema(connection, alvo, { timeoutMs: resolved.timeoutMs });

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

// Commander sai com 1 em erro de uso; a spec reserva 2 para isso.
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
