# dbq — a read-only query runner for MySQL, PostgreSQL and MongoDB

- **Date:** 2026-09-03
- **Status:** approved, ready for an implementation plan
- **Repository:** `~/Developer/personal/dbq`

## Objective

A CLI that runs read queries against MySQL, PostgreSQL and MongoDB, configured by environment files under `~/.config/dbq/`, designed to be invoked by an AI agent from any directory.

The primary consumer is not a human. That inverts two usual CLI priorities: output is optimised to be parsed and to not blow up a context window, and no execution path may block waiting on interactive input.

## The central invariant

**`dbq` never writes. Ever.**

No flag, environment variable or config file unlocks writes. This is not a default — it is a structural property of the program, enforced by validation that runs before any connection is opened.

Every decision below follows from that invariant. Any future change that weakens it invalidates this design and demands a fresh review.

## Scope

**In:** MySQL, PostgreSQL and MongoDB; read queries; schema discovery; per-project and per-environment configuration; JSON and table output.

**Out (MVP):** OpenSearch, Redis; writes of any kind; `${VAR}` expansion in URIs (noted as a possible v2 — in the MVP the URI is plaintext); publishing to npm; any interactive prompt.

## Architecture

```
src/
  cli.ts                  argv parsing, orchestration, printing (thin on purpose)
  config/
    resolveProject.ts     cwd → git root → basename, or --project
    loadEnv.ts            reads and validates the env file, resolves --db
  guards/
    sql.ts                validates a MySQL string (pure, no I/O)
    postgres.ts           validates a PostgreSQL string (pure, no I/O)
    mongo.ts              parses db.<col>.<op>(...) via AST (pure, no I/O)
  engines/
    mysql.ts              runs what the guard approved
    postgres.ts           same, inside a BEGIN READ ONLY transaction
    mongo.ts              same
  output/
    envelope.ts           result → JSON or table
```

### The boundary that carries the project

**Guards never open a connection. Engines never see raw input.**

The engine receives an already-validated structure — a collection, an operation drawn from a whitelist, arguments already proven to be literals. There is no code path in which a user-supplied string reaches the driver without crossing the guard.

Practical consequence: the guards are pure functions, exhaustively testable with no database at all. That is where the risk lives, and that is where the test suite lives.

### Data flow

```
argv → resolveProject → loadEnv → guard → engine → envelope → stdout
```

## Stack

```
typescript      types; checked via `tsc --noEmit`, never at runtime
commander       commands, flags, generated --help
mysql2          MySQL driver
pg + pg-cursor  PostgreSQL driver and cursor-based truncation
mongodb         Mongo driver
acorn           AST for the Mongo guard
picocolors      colour, exclusively with --format table on a TTY stdout
vitest          tests
pnpm            package manager
```

**No build step.** Node 26 runs `.ts` directly via native type stripping (verified on the target machine). `package.json`'s `bin` points at `src/cli.ts` with a `#!/usr/bin/env node` shebang; installation via `npm link` during development.

Discipline demanded by type stripping: no `enum`, `namespace` or parameter properties, and internal imports carry an explicit extension (`./guards/sql.ts`).

**No `@clack/prompts` and no `ora`.** Both serve interactive sessions, which is precisely what `dbq` is not. A prompt blocks waiting on a TTY that does not exist when an agent invokes it — the command does not fail, it *hangs*, the worst failure mode for an automated tool. A spinner writes cursor escapes to stdout and contaminates output destined for `JSON.parse`. No flow in this design needs to ask anything.

**Commander despite the small surface.** The auto-generated `--help`, always in sync with the real flags, is what an agent reads when it meets an unknown binary. That is worth more than the handful of `util.parseArgs` lines it replaces.

## Configuration

### Location

```
~/.config/dbq/<project>/<env>.json
```

`$XDG_CONFIG_HOME` is honoured when set. `dbq` owns its own directory rather than scattering project names directly into `~/.config/`, which is shared ground with `nvim`, `gh`, `fish` and others — a name collision between a personal project and a real tool is a matter of time.

### Format

```json
{
  "connections": {
    "mongo": {
      "engine": "mongodb",
      "uri": "mongodb://user:password@host:27017/mydb",
      "database": "mydb"
    },
    "mysql": {
      "engine": "mysql",
      "uri": "mysql://reader:password@10.0.0.1:3306/mydb"
    }
  },
  "defaults": { "limit": 500, "timeoutMs": 30000 }
}
```

An env file groups **N named connections**, because a real environment is not a single database — in the original target project, `dev` is MongoDB and MySQL simultaneously. Switching environments stays a single action, and `--env` remains the explicit, noisy axis separating dev from production.

`--db` is optional when the environment declares a single connection.

The `database` field is the connection's **default** database, and it is optional. A database name in the URI path is always ignored.

**Revision of 2026-09-03**, after first real use: the original version required `database` in the file and treated it as the single source of truth. A cluster hosts several databases — the dev one had seven — so pinning one per file forced a named connection per database. The `-D, --database` flag now overrides the default per invocation.

The reason behind the original rule still holds: it existed to stop two *implicit* sources (the field and the URI path) from disagreeing. An explicit flag is not ambiguity, it is an override — and the URI path stays ignored.

When neither the field nor the flag resolves a database, the error lists the cluster's databases, the same way the project error lists the projects.

### Credential hygiene

- `dbq` **refuses to run** if the env file is not mode `0600`, with a message saying how to fix it. These files hold production passwords.
- Operational recommendation (not code): point the URIs at a **read-only user in the database itself**. The guard protects against human error; the database user protects against a bug in the guard.

### Project resolution

`dbq` walks up from the cwd to the git repository root and uses the directory's basename. If nothing matches under `~/.config/dbq/`, it **fails** — with the list of available projects in the error text, so that re-invoking with `--project` is immediate. It never guesses, never falls back to a default.

`--project` overrides detection. There is no persisted "active project" anywhere: invisible global state is how you get the command right and the database wrong.

## CLI surface

```bash
dbq --env dev "SELECT id, name FROM companies WHERE active = 1"
dbq --env dev --db mongo 'db.companies.find({ active: true }).limit(10)'
dbq --project my-project --env prod --db mysql "SHOW TABLES"
cat pipeline.js | dbq --env dev --db mongo -
```

| Flag | Default | Note |
|---|---|---|
| `--project <name>` | detected from cwd | |
| `--env <name>` | — | required |
| `--db <connection>` | the env's only one | required when there is more than one |
| `--limit <n>` | `500` | `0` disables it |
| `--timeout <ms>` | `30000` | |
| `--format json\|table` | `json` | |
| `--explain` | off | runs `EXPLAIN` / `.explain()` |

`--explain` is applied by the **engine**, after the guard approves the original query. The user does not write `.explain()` in the expression — `explain` is not on the chainable whitelist and would be refused. In SQL the engine prefixes `EXPLAIN`; in Mongo it wraps the already-built cursor.

Query via the positional argument, or `-` to read stdin — an `aggregate` pipeline with many stages is miserable to escape in a shell.

### Discovery subcommands

```bash
dbq envs                                    available projects and environments
dbq schema --env dev --db mysql             tables
dbq schema --env dev --db mysql companies   a table's columns
dbq schema --env dev --db mongo             collections (+ shape inferred from a sample)
```

This is **central, not an accessory**. An agent that cannot see the schema guesses column names, fails, re-invokes, and burns turn after turn. Giving away `schema` is what turns `dbq` from a runner into a tool an agent can use on its own.

## Output and limits

The consumer's enemy is not ugliness, it is **volume**: a bare `SELECT * FROM companies` can dump hundreds of thousands of rows straight into the context window and burn an entire session in one command.

- **JSON on stdout by default**, an envelope carrying `rows`, `rowCount`, `truncated`, `elapsedMs`. `--format table` for human reading.
- **A default ceiling of 500 injected**, applied even when the query does not ask for one. When it truncates, `truncated: true` accompanies the real total — the consumer knows to refine instead of believing it saw everything. `--limit 0` disables it, explicitly.
- **`maxTimeMS` / a 30s statement timeout**, adjustable per environment.

The injected ceiling means the runner does not literally honour a query asking for `LIMIT 5000`. That is deliberate: the two mistakes cost asymmetrically — injecting too small a limit costs one re-invocation; injecting none costs the session.

### The limit is a ceiling, not a replacement

When the query already declares its own limit (`LIMIT 10`, `.limit(10)`), the **smaller** of the two wins. `--limit 500` over a query with `LIMIT 10` returns 10 rows, and `truncated` is `false`. The injected limit never enlarges a result, only caps it.

### How the limit is applied

- **Mongo:** `.limit(n + 1)` on the cursor. If `n + 1` documents come back, the extra is discarded and `truncated: true` is set.
- **SQL:** client-side truncation, consuming the result as a stream and stopping at `n + 1` rows. No subquery wrapping (`SELECT * FROM (...) LIMIT n`), which would break `SHOW`, `DESCRIBE` and `EXPLAIN` and would distort the execution plan.

### Configuration precedence

Invocation flag > the env file's `defaults` > the built-in default. Applies to `limit` and `timeoutMs`.

## The MongoDB guard

The accepted grammar, and nothing beyond it:

```
db.<collection>.<readOp>(<literals>)  [.limit(n)|.sort({..})|.skip(n)|.project({..})]*
```

The algorithm, via `acorn`:

1. Parse as a **Program**, requiring exactly one `ExpressionStatement`. Kills `db.x.find({}); db.y.drop()`.
2. Unwind the chain down to the base, which must be `db.<collection>` with **`computed: false`**. Kills `db["compa" + "nies"]["dr" + "op"]()` — not by inspecting strings, but because bracket access is not the accepted shape.
3. Every operation must be on a whitelist. Terminal: `find`, `findOne`, `aggregate`, `countDocuments`, `estimatedDocumentCount`, `distinct`. Chainable: `limit`, `sort`, `skip`, `project`.
4. Every argument must be a **pure literal**, verified recursively: object (non-computed keys, no spread), array (no spread), string, number, boolean, `null`, unary minus on a number, and regex literals. Identifiers, calls, template strings, concatenation and arrow functions are refused.
5. A **deep key scan** across all arguments, refusing at any depth:
   - `$out`, `$merge` — **write to a collection**
   - `$where`, `$function`, `$accumulator` — execute JS on the server

Step 5 exists because the first four, alone, approve `db.companies.aggregate([{ $out: "backup" }])`, which writes data. A pipeline is syntactically a pure literal; the write hides in the *content* of the data, not in the shape of the code. The operation whitelist cannot reach that.

Regex literals are **allowed**: `find({ name: /acme/i })` is a legitimate read and executes no code. A catastrophic regex consumes server CPU, but that is cost, not writing, and it falls under the `maxTimeMS` net.

## The SQL guard

1. Normalise by removing comments **before** examining the leading keyword — otherwise `/*x*/ DROP TABLE y` passes the "does not start with DROP" check.
2. Require a single statement (no `;` chaining).
3. The leading keyword must be one of `SELECT`, `WITH`, `SHOW`, `DESCRIBE`, `EXPLAIN`.
4. Refuse `INTO OUTFILE`, `INTO DUMPFILE` (write files) and `FOR UPDATE` (does not write, but takes row locks — side effect enough in production).
5. Defence in depth at the driver: `multipleStatements: false` set explicitly in mysql2.

## Errors and exit codes

Distinct codes because each implies a different corrective action, and the reader is an agent choosing its next step:

| Code | Meaning | Implied action |
|---|---|---|
| `0` | success | — |
| `1` | unexpected | — |
| `2` | invalid usage (missing flag, unknown env) | fix the invocation |
| `3` | refused by the guard | rewrite the query |
| `4` | connection / authentication | wrong env, or VPN down |
| `5` | database error (syntax, missing collection) | check the schema |
| `6` | timeout | filter harder |

With `--format json`, the error goes to **stderr** as JSON:

```json
{ "error": { "code": "READONLY_VIOLATION",
             "message": "operation 'drop' is not allowed",
             "hint": "read operations: find, findOne, aggregate, countDocuments, distinct" } }
```

The `hint` field is deliberate: it is what makes the agent's second attempt correct instead of its fifth.

**Credentials never appear in an error message.** Database drivers echo the entire connection string, password included, when authentication fails. The URI is scrubbed before any byte reaches stderr.

## Test strategy

Vitest, with the weight concentrated where the risk is.

- **Guards — the bulk of the suite, written first (TDD).** Pure functions, table-driven, no database. Two corpora:
  - queries that **must pass**;
  - an adversarial corpus that **must be refused**: `$out` nested in a pipeline, `$merge`, `db["dr"+"op"]()`, chained `;DROP`, `DROP` hidden behind a comment, `INTO OUTFILE`, `FOR UPDATE`, `$where`, `$function`, chaining outside the whitelist, an argument containing a function call.

  Every hole described in this document becomes a test before it becomes code.
- **Config resolution**: temporary directories, a fake `~/.config`, cwd detection against a synthetic git repo, refusal on a mode other than `0600`.
- **Envelope and truncation**: pure, cheap.
- **Engines**: opt-in integration via an environment variable, against Mongo and MySQL in Docker. They do not block the main suite.

The adversarial guard suite may not be skipped or marked `.skip` to unblock a build: it **is** the project's invariant.

## Revision of 2026-09-03 — PostgreSQL

Added as a third engine. Redis was considered alongside it and **rejected**: it
has no query language, no schema and no rows, so `dbq schema` and the row
ceiling have no meaning there, and its characteristic hazard is not writing but
`KEYS *` blocking a single-threaded server — something read-only does not
protect against. A cache is not a query target.

PostgreSQL is **not MySQL with a different driver**, and reusing the MySQL guard
would have been a security bug:

1. **A write keyword may appear anywhere.**
   `WITH x AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM x` is a real
   PostgreSQL feature: it begins at `WITH`, ends in `SELECT`, and writes. The
   leading-keyword rule that suffices for MySQL does not see it. The PostgreSQL
   guard therefore scans for write keywords at every position.
2. **It lexes differently.** `"` delimits an identifier rather than a string,
   block comments nest, and `$$ … $$` dollar quoting can hide a whole
   statement. The MySQL normaliser produces both false positives (a column
   legitimately named `"delete"`) and false negatives against it, so PostgreSQL
   has its own.
3. **Its function surface reaches the host.** `COPY … TO PROGRAM` runs a shell
   command; `pg_read_file`, `pg_ls_dir` and `lo_export` reach the filesystem;
   `dblink` opens an outbound connection from the server; `nextval`/`setval`
   mutate sequences. All refused by fragment.
4. **`EXPLAIN ANALYZE` executes the statement.** `--explain` never adds
   `ANALYZE`, and `ANALYZE` is a refused keyword.

In exchange, PostgreSQL offers something the other engines cannot: every query
runs inside `BEGIN READ ONLY` with a server-side `SET LOCAL statement_timeout`,
and is rolled back. **This is the one engine where a hole in the parser is not a
hole in the guarantee** — the backend refuses the write itself.

One thing the corpus corrected: `SELECT $$ DROP TABLE t $$` was initially
written as a case that must be refused. It must be *accepted*. Dollar quoting is
alternative string-literal syntax, so that statement returns the text and
executes nothing, exactly like `SELECT 'DROP TABLE t'`. Execution enters through
`DO`, which is refused on its own.

**Schemas (namespaces)** are an axis MySQL and Mongo lack. Rather than adding a
flag, `dbq schema` qualifies its results (`public.users`) and accepts a target
either bare or qualified — the axis appears where it helps rather than in every
invocation.

Truncation uses `pg-cursor`: without a cursor the driver buffers the whole
result before the ceiling could be applied, which is precisely the volume
problem the ceiling exists to prevent. Utility statements (`SHOW`, `EXPLAIN`)
are not cursorable and return few rows, so they are buffered.

## Recorded decisions

| Decision | Rejected alternative | Reason |
|---|---|---|
| Pure read-only, no escape hatch | Writes behind a flag + a permissive env | Production one typo away; an agent must not be able to self-authorise |
| An env groups N connections | One file per connection | Mirrors the real environment; `dev-mysql` and `prod-mysql` as neighbouring strings invite the mistake |
| Project auto-detected from cwd, fails loudly | Mandatory `--project`; a persisted active project | Ergonomics without invisible global state |
| mongosh syntax parsed as an AST | `eval` of the string; structured arguments | The ergonomics of the former with the guarantee of the latter; `eval` turns the invariant into a hope |
| A 500-row ceiling injected | Honour the query as written | Asymmetric cost: one re-invocation versus the session |
| No build step (native type stripping) | `tsx` + `tsup` | Fewer moving parts; a bundler returns if publishing happens |
| No Clack, no ora | An interactive CLI | A prompt hangs with no TTY; a spinner contaminates stdout |
| A dedicated PostgreSQL guard | Reusing the MySQL guard | Data-modifying CTEs and a different lexer; reuse would have been a security bug |
| PostgreSQL wrapped in BEGIN READ ONLY | Trusting the guard alone | The server enforces it, so a parser hole is not a guarantee hole |
| Redis rejected | A command whitelist engine | No query language, no schema, no rows; its hazard is blocking, not writing |
