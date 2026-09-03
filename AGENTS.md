# dbq — Knowledge Base

**Stack**: TypeScript run directly by Node 26 (native type stripping, no build step) + Commander + mysql2 + mongodb + acorn + Vitest + pnpm

A read-only query runner for SQL and MongoDB. The primary consumer is an **AI agent**, not a person — that inverts the usual CLI priorities and explains nearly every design decision here.

## Quick Start

```bash
pnpm install
pnpm test          # vitest
pnpm typecheck     # tsc --noEmit
npm link           # puts the `dbq` binary on PATH
node src/cli.ts --help
```

There is no build step. `package.json`'s `bin` points at `src/cli.ts`.

## The invariant

**`dbq` never writes. Ever.**

No flag, environment variable or config field unlocks writes. This is not a default — it is a structural property, enforced by validation that runs **before any connection is opened**.

Every decision in this repository follows from that. If a change weakens the invariant, the change is wrong, even when the tests pass.

Worth internalising: `dbq -e production 'db.plans.drop()'` exits `3` **without touching the network**. The guard runs before the engine.

## Architecture

```
src/
  cli.ts                  argv, orchestration, printing, error → exit code
  config/
    types.ts              Connection, EnvConfig, ResolvedConnection, defaults
    resolveProject.ts     XDG root, listing, project detection from cwd
    loadEnv.ts            reads/validates the env file, resolves --db and --database
  guards/
    types.ts              SqlPlan, MongoPlan — the guard → engine contract
    sql.ts                validates the SQL string   (pure, zero I/O)
    mongo.ts              parses an AST via acorn    (pure, zero I/O)
  engines/
    mysql.ts              runs what the guard approved; truncates while streaming
    mongo.ts              same; applies limit(n+1) and maxTimeMS
  schema/
    mysql.ts              SHOW TABLES / DESCRIBE
    mongo.ts              listCollections / shape inferred from a sample
  output/
    envelope.ts           truncation, serialisable JSON, table, error
  errors.ts               DbqError, codes → exit codes, scrubUri
```

### The boundary the project rests on

**Guards never open a connection. Engines never see raw input.**

The engine receives an already-validated structure — a collection, an operation drawn from a whitelist, arguments already proven to be literals. There is no code path where a user-supplied string reaches the driver without crossing the guard.

That is what makes read-only structural rather than hopeful, and it is why the guards are pure functions: the suite protecting the invariant runs with no database at all.

**When working here:** if you find yourself passing a raw string into `engines/`, stop. The right type is `SqlPlan` or `MongoPlan`.

### Flow

```
argv → resolveProject → loadEnv → guard → engine → envelope → stdout
```

## Conventions

### TypeScript under type stripping

Node erases types at runtime but **does not transform code**. That rules out:

- `enum` — use `as const` + `(typeof X)[keyof typeof X]`
- `namespace`
- parameter properties (`constructor(private x: string)`)
- decorators

`tsconfig` enables `erasableSyntaxOnly`, so `pnpm typecheck` fails if anyone slips. Internal imports **carry an explicit extension**: `import { guardSql } from './guards/sql.ts'`.

### Style

- **Named exports only** — never `export default`. The sole exception is `vitest.config.ts`, which Vitest requires.
- **ESM** (`"type": "module"`).
- **Arrow functions** for modules; `class` only for `DbqError`.
- **Runtime strings stay in Portuguese** — error messages, hints, table footers. Code, comments, tests and documentation are in English. Exit codes and `error.code` are the stable contract; the prose is not, so never key logic on message text.
- **Comments explain why, not what.** The existing ones mark non-obvious decisions (why `ETIMEDOUT` is checked before `ECONNREFUSED`, why the identifier interpolation in `schema/mysql.ts` is safe). Keep that bar — don't comment the obvious.
- **Derive unions from objects** instead of hand-writing them. See `MONGO_READ_OPS` / `MongoReadOp` in `guards/types.ts`.

### Output

- **JSON never receives ANSI.** Colour only with `--format table` **and** `process.stdout.isTTY`. One escape byte in JSON breaks the consumer's `JSON.parse`.
- **Nothing blocks waiting on a TTY.** No prompts, no spinners — a command that *hangs* is the worst failure mode for an automated tool. `@clack/prompts` and `ora` were deliberately rejected for this reason.
- **Every error carries an actionable `hint`.** It is the field that makes the agent's second attempt correct instead of its fifth.
- **Credentials never reach stderr.** Every message passes through `scrubUri`. Drivers love echoing the entire connection string when auth fails.

### Errors and exit codes

Distinct codes, because each implies a different corrective action:

| Code | `DbqErrorCode` | Implied action |
|---|---|---|
| 0 | — | — |
| 1 | `UNEXPECTED` | — |
| 2 | `USAGE` | fix the invocation |
| 3 | `READONLY_VIOLATION` | rewrite the query |
| 4 | `CONNECTION_ERROR` | check `--env` and the network |
| 5 | `DATABASE_ERROR` | check with `dbq schema` |
| 6 | `TIMEOUT` | filter harder |

Use `toConnectionError` — not `toDbqError` — for any failure raised **while the connection is still opening**. Without it a `connect ETIMEDOUT` becomes `TIMEOUT` and the consumer is told to "narrow the query" for a socket that never opened.

### Errors that list alternatives

When `dbq` cannot resolve something it **does not guess**: it fails and puts the alternatives in the message. An uninferred project lists the projects; a missing environment lists the environments; an undefined database lists the cluster's databases. Keep that pattern for any new resolution — it is what turns an error into a correct re-invocation.

## Tests

Vitest, with the weight where the risk is.

```bash
pnpm test
pnpm vitest run tests/guards/    # only the suite guarding the invariant
```

- **Names begin with `it should be` / `it should when`.**
- **`tests/guards/` is non-negotiable.** Two corpora: queries that must pass, and an adversarial corpus that must be refused (`$out` nested inside `$facet`, `db["dr"+"op"]()`, `;DROP`, `DROP` hidden behind a comment, `INTO OUTFILE`, `$where` inside `$and`, chaining outside the whitelist). Not one case may be skipped or marked `.skip` to unblock a build — that suite **is** the invariant.
- **Every hole found becomes a test before it becomes a fix.**
- Engines have no unit tests: they are almost entirely I/O. The testable part — truncation — lives in `applyLimit`, covered under `tests/output/`.

## Where to add code

| What | Where | Don't forget |
|---|---|---|
| New Mongo read operation | `MONGO_READ_OPS` in `guards/types.ts` + a `case` in `engines/mongo.ts` | a test in the passing corpus |
| New forbidden operator | `FORBIDDEN_KEYS` in `guards/types.ts` | an adversarial test, including nested |
| New forbidden SQL fragment | `FORBIDDEN_FRAGMENTS` in `guards/sql.ts` | an adversarial test |
| New subcommand | `src/cli.ts` + the `SUBCOMMANDS` array | that array feeds the subcommand-as-query refusal |
| New engine (Postgres, etc.) | `src/engines/<name>.ts` + its own guard in `src/guards/` | the guard comes **first**, with an adversarial corpus |
| New config field | `src/config/types.ts` + validation in `loadEnv.ts` | a precedence test: flag > file > built-in |

## Anti-patterns

**NEVER:**

- Add a flag, env var or field that permits writes.
- Use `eval`, `new Function` or `vm` to interpret a query — the Mongo guard is a **parsed** AST, never an evaluated one; it was the most important design decision in the project.
- Pass a raw user string into `engines/`.
- Reorder `argv` yourself to "fix" subcommand ordering — it breaks for anyone with a connection of the same name.
- Write ANSI to stdout when the format is JSON.
- Interpolate a user value into SQL. The one interpolation that exists (`schema/mysql.ts`) is preceded by an `^[A-Za-z0-9_$]+$` allowlist; if you need another, replicate the allowlist or don't interpolate.
- Delete or skip a test to make a build pass.

**Watch out for:**

- `applyLimit` is a ceiling, not a replacement. A query already asking for less still wins.
- Engines fetch `n + 1` rows on purpose — that is how `truncated` is detected without an extra `COUNT`.
- The URI path **never** determines the database. Only the `database` field and the `-D` flag do.

## Documentation

| Document | What it holds |
|---|---|
| [README.md](README.md) | usage, configuration, what is allowed |
| [docs/specs/2026-09-03-dbq-design.md](docs/specs/2026-09-03-dbq-design.md) | the design and the **why** behind each decision, with rejected alternatives |
| [docs/plans/2026-09-03-dbq.md](docs/plans/2026-09-03-dbq.md) | the implementation plan, task by task |

The spec carries a decision table at the end and a dated revision covering `--database`. **Read the spec before changing behaviour** — several choices that look arbitrary have an alternative that was already considered and rejected for a recorded reason.

If you change a design decision, **add a dated revision to the spec** rather than rewriting the original. The history of the reasoning is worth more than a permanently tidy document.
