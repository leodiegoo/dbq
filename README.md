# dbq

A **read-only** query runner for MySQL, PostgreSQL and MongoDB, configured per environment and callable from any directory.

Built to be driven by an AI agent: output is parseable JSON, errors carry an actionable hint, exit codes distinguish "rewrite the query" from "wrong connection" — and **no code path can write to the database**.

```bash
dbq --env dev "SELECT id, name FROM companies WHERE active = 1"
dbq --env dev --db mongo 'db.companies.find({ active: true }).limit(10)'
```

---

## Contents

- [Why this exists](#why-this-exists)
- [Requirements](#requirements)
- [Install](#install)
- [Configuration](#configuration)
- [Usage](#usage)
- [Discovery](#discovery-envs-databases-schema)
- [What is allowed](#what-is-allowed)
- [Limits and truncation](#limits-and-truncation)
- [Output](#output)
- [Exit codes](#exit-codes)
- [How it works](#how-it-works)
- [Recipes](#recipes)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

---

## Why this exists

Handing an AI agent direct database access creates two independent problems.

**The first is destruction.** An agent with the wrong context runs `DELETE` against production with no ill intent whatsoever. The usual answer — "trust the prompt" — is not an answer. `dbq` refuses writes **structurally**: the query is validated before any connection is opened, and no flag, environment variable or config field unlocks it.

```bash
$ dbq --env production 'db.plans.drop()'
{ "error": { "code": "READONLY_VIOLATION", "message": "operation 'drop' is not allowed", … } }
$ echo $?
3
```

Not a single network packet left the machine for that command.

**The second is volume.** A bare `SELECT * FROM companies` returns hundreds of thousands of rows straight into the context window and burns an entire session in one command. `dbq` injects a row ceiling even when the query doesn't ask for one, and tells you when it truncated.

---

## Requirements

- **Node >= 26.** The binary points straight at a `.ts` file and Node strips the types at runtime — no build step, no `dist/`.
- MySQL, PostgreSQL and/or MongoDB reachable over the network (VPN, if that applies).

---

## Install

```bash
git clone https://github.com/leodiegoo/dbq.git
cd dbq
pnpm install
npm link
```

`npm link` puts `dbq` on your PATH. Check it:

```bash
dbq --version   # 0.1.0
dbq --help
```

> `npm link` is the development path — source edits take effect immediately, with no reinstall.

---

## Configuration

### Where files live

```
~/.config/dbq/<project>/<env>.json
```

`$XDG_CONFIG_HOME` is honoured when set. `dbq` owns its own directory rather than scattering project names directly into `~/.config/` — shared ground with `nvim`, `gh`, `fish` and others.

A machine with two projects:

```
~/.config/dbq/
├── my-project/
│   ├── dev.json
│   ├── staging.json
│   └── production.json
└── other-project/
    └── local.json
```

### Creating your first file

```bash
mkdir -p ~/.config/dbq/my-project

cat > ~/.config/dbq/my-project/dev.json <<'EOF'
{
  "connections": {
    "mysql": {
      "engine": "mysql",
      "uri": "mysql://reader:password@10.0.0.1:3306/mydb"
    },
    "mongo": {
      "engine": "mongodb",
      "uri": "mongodb://reader:password@10.0.0.2:27017",
      "database": "mydb"
    }
  },
  "defaults": { "limit": 500, "timeoutMs": 30000 }
}
EOF

chmod 600 ~/.config/dbq/my-project/dev.json
```

**The `chmod 600` is not optional:** `dbq` refuses to run if the mode is anything else. These files hold credentials.

```
USAGE: /Users/…/dev.json has mode 644; expected 600
hint: run: chmod 600 /Users/…/dev.json
```

### Fields

| Field | Required | What it is |
|---|---|---|
| `connections` | yes | map of named connections |
| `connections.<name>.engine` | yes | `"mysql"`, `"postgres"` or `"mongodb"` |
| `connections.<name>.uri` | yes | full connection URI |
| `connections.<name>.database` | no | **default** database for this connection |
| `defaults.limit` | no | row ceiling (built-in: `500`) |
| `defaults.timeoutMs` | no | statement timeout (built-in: `30000`) |

**Precedence:** invocation flag > file `defaults` > built-in default.

A database name in the URI path is **always ignored**. Only the `database` field and the `-D` flag decide where the query runs, so no two implicit sources can disagree.

### One file groups N connections

A real environment is not a single database: `dev` is usually MySQL **and** MongoDB at the same time. So the unit is the environment, with named connections inside it.

`--db` is optional when the environment declares a single connection, and required when there is more than one:

```
USAGE: env 'dev' has several connections: mysql, mongo
hint: pass --db <connection>
```

The shape is deliberate: switching environments is **one** action, and `--env` stays the explicit axis separating dev from production. With one file per connection, `dev-mysql` and `prod-mysql` would be neighbouring strings in the same argument — precisely the mistake worth making hard.

### Passwords with special characters

The password lives in the URI, so it must be percent-encoded. Characters that **break** unescaped: `#` `@` `/` `:` `?` `&` `%`.

```bash
node -e 'console.log(encodeURIComponent(process.argv[1]))' 'my#pass@word'
# my%23pass%40word
```

### How the project is discovered

`dbq` walks up from the current directory to the git repository root and uses its basename. Anywhere inside `~/code/my-project`, `--project` is unnecessary.

If nothing matches under `~/.config/dbq/`, it **fails** and lists the alternatives — it never guesses, never falls back to a default:

```
USAGE: could not infer the project from '/tmp'. Available: my-project, other-project
hint: pass --project <name>
```

There is no persisted "active project" anywhere. Invisible global state is how you get the command right and the database wrong.

### Security recommendation

Point the URIs at a **read-only user in the database itself**.

```sql
CREATE USER 'dbq_reader'@'%' IDENTIFIED BY '…';
GRANT SELECT, SHOW VIEW ON mydb.* TO 'dbq_reader'@'%';
```

```js
db.createUser({ user: "dbq_reader", pwd: "…", roles: [{ role: "read", db: "mydb" }] })
```

The guard protects you from human error; the database user protects you from a bug in the guard. Different layers — you want both.

---

## Usage

```bash
dbq [options] <query>
```

| Flag | Default | What it does |
|---|---|---|
| `-p, --project <name>` | inferred from cwd | project under `~/.config/dbq` |
| `-e, --env <name>` | — | **required** |
| `-d, --db <connection>` | the env's only one | required when there is more than one |
| `-D, --database <name>` | the `database` field | database to query, per invocation |
| `-l, --limit <n>` | `500` | row ceiling; `0` disables it |
| `-t, --timeout <ms>` | `30000` | statement timeout |
| `-f, --format <json\|table>` | `json` | output format |
| `-x, --explain` | off | run `EXPLAIN` / `.explain()` instead |

### SQL

```bash
dbq -e dev -d mysql "SELECT id, name FROM companies WHERE active = 1"
dbq -e dev -d mysql "SHOW TABLES"
dbq -e dev -d mysql -x "SELECT * FROM orders WHERE user_id = 42"

dbq -e dev -d pg "SELECT id, name FROM companies WHERE active"
dbq -e dev -d pg "TABLE companies"
```

### MongoDB

The expression uses `mongosh` syntax, with `db` referring to the resolved database:

```bash
dbq -e dev -d mongo 'db.companies.find({ active: true })'
dbq -e dev -d mongo 'db.companies.find({}, { name: 1 }).sort({ name: 1 }).limit(20)'
dbq -e dev -d mongo 'db.orders.aggregate([{ $match: { paid: true } }, { $group: { _id: "$userId", n: { $sum: 1 } } }])'
```

### Query from stdin

Long pipelines are miserable to escape in a shell. Use `-`:

```bash
cat pipeline.js | dbq -e dev -d mongo -
dbq -e dev -d mysql - < query.sql
```

### Switching databases without switching connections

One cluster hosts many databases. `-D` overrides the default per invocation:

```bash
dbq databases -e dev -d mongo                          # find out what exists
dbq -e dev -d mongo -D other-database 'db.users.find({})'
dbq -e dev -d mysql -D information_schema "SELECT DATABASE()"
```

In MySQL, cross-database queries also work with no flag at all: `SELECT * FROM otherdb.table` passes normally, provided the user has permission.

---

## Discovery: `envs`, `databases`, `schema`

An agent that cannot see the schema guesses column names, fails, and burns turn after turn. The full trail:

```bash
dbq envs                                  # configured projects and environments
dbq databases -e dev -d mongo             # databases on that connection
dbq schema -e dev -d mysql                # tables
dbq schema -e dev -d pg                   # tables, qualified as schema.table
dbq schema -e dev -d mysql companies      # columns, types, keys
dbq schema -e dev -d mongo                # collections
dbq schema -e dev -d mongo companies      # fields, types and presence
```

Mongo's `schema` samples 100 documents and reports **presence** per field — the signal that keeps you from writing a query against an optional field:

```
field        types          presence
-----------  -------------  --------
_id          objectid       100%
createdAt    date           100%
email        string         100%
lastLoginAt  date           86%
deletedAt    date | null    14%
```

`lastLoginAt` on 86% of the sample and `deletedAt` on 14% is exactly the signal
that stops you filtering on a field most documents don't have.

> **Subcommands come before flags.** `dbq schema -e dev`, not `dbq -e dev schema`. The wrong order is refused, with the corrected invocation in the hint.

---

## What is allowed

### SQL (MySQL)

**Accepted:** `SELECT`, `WITH … SELECT`, `SHOW`, `DESCRIBE`, `EXPLAIN`.

**Refused:** everything else, plus `INTO OUTFILE` and `INTO DUMPFILE` (write files on the server), `FOR UPDATE` and `LOCK IN SHARE MODE` (take row locks).

Comments are stripped **before** the leading-keyword check, and string literals are neutralised:

```sql
/* harmless */ DROP TABLE companies     -- refused
SELECT 1; DROP TABLE companies          -- refused (single statement only)
SELECT * FROM t WHERE name = 'a;b'      -- accepted (the ; is inside a string)
```

### SQL (PostgreSQL)

PostgreSQL gets its own guard, because it is not MySQL with a different driver.

**Accepted:** `SELECT`, `WITH`, `TABLE`, `VALUES`, `SHOW`, `EXPLAIN`.

**Every write keyword is refused at any position**, not just at the start:

```sql
WITH x AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM x   -- refused
```

That statement begins at `WITH`, ends in `SELECT`, and writes. Data-modifying
CTEs are a real PostgreSQL feature, and a leading-keyword check does not see
them.

Also refused: `COPY … TO PROGRAM` (runs a shell command on the server), `COPY`
to or from a file, `pg_read_file` / `pg_ls_dir` / `lo_export` (server
filesystem), `nextval` / `setval` (mutate a sequence), `pg_sleep` and advisory
locks, `dblink` (outbound connection from the server), row locks, transaction
control, and `EXPLAIN ANALYZE` — which actually executes the statement, so
`--explain` never adds `ANALYZE`.

**And the server enforces it too.** Every PostgreSQL query runs inside:

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = <timeout>;
<your query>
ROLLBACK;
```

This is the one engine where a hole in the parser is not a hole in the
guarantee: the backend rejects writes on its own. `statement_timeout` is
server-side for the same reason.

Note that `$$ … $$` dollar quoting is string syntax, not execution:
`SELECT $$ DROP TABLE t $$` returns the text and is accepted, exactly like
`SELECT 'DROP TABLE t'`. Execution enters through `DO`, which is refused.

### MongoDB

**Accepted shape:** exactly `db.<collection>.<operation>(…)`, optionally chained.

| | |
|---|---|
| Operations | `find` `findOne` `aggregate` `countDocuments` `estimatedDocumentCount` `distinct` |
| Chainable | `limit` `sort` `skip` `project` |
| Arguments | pure literals only: object, array, string, number, boolean, `null`, regex |

The expression is **parsed as an AST, never evaluated**. That is not an implementation detail — it is the decision the whole guarantee rests on:

```js
db.companies.drop()              // refused: operation not on the whitelist
db["compa" + "nies"].drop()      // refused: bracket access is not the accepted shape
db.c.find({ a: fn() })           // refused: argument is not a pure literal
db.c.find({}).toArray()          // refused: chained call not on the whitelist
db.c.find({}); db.d.drop()       // refused: more than one statement
```

`db["compa" + "nies"]` does not die because something inspected the string looking for `drop` — it dies because concatenation simply isn't part of the accepted grammar.

**Operators refused at any depth** inside the arguments:

| Operator | Why |
|---|---|
| `$out`, `$merge` | **write to a collection** |
| `$where`, `$function`, `$accumulator` | execute JavaScript on the server |

```js
db.c.aggregate([{ $out: "backup" }])                    // refused
db.c.aggregate([{ $facet: { a: [{ $out: "x" }] } }])    // refused, nested
db.c.find({ $and: [{ $where: "true" }] })               // refused, nested
```

This exists because the operation whitelist **cannot reach** those cases: a pipeline containing `$out` is syntactically a pure literal. The write hides in the content of the data, not in the shape of the code.

> No flag unlocks writes. If you need to write, `dbq` is the wrong tool.

---

## Limits and truncation

`--limit` is a **ceiling**, not a replacement — a query that already asks for less still wins:

| Query | `--limit` | Result |
|---|---|---|
| `find({})` over 134 docs | 500 | 134 rows, `truncated: false` |
| `find({})` over 134 docs | 3 | 3 rows, `truncated: true` |
| `find({}).limit(2)` | 3 | 2 rows, `truncated: false` |

`--limit 0` disables the ceiling, explicitly.

When it truncates, the output says so — the consumer knows to refine instead of believing it saw everything:

```json
{ "rowCount": 3, "truncated": true, "elapsedMs": 54, "rows": [ … ] }
```

The injected ceiling means `dbq` does not literally honour a `LIMIT 5000`. That is deliberate: the two mistakes cost asymmetrically — injecting too small a limit costs one re-invocation, injecting none costs the session.

---

## Output

**JSON** by default, in an envelope with metadata:

```json
{
  "project": "my-project",
  "env": "dev",
  "db": "mysql",
  "engine": "mysql",
  "rowCount": 2,
  "truncated": true,
  "elapsedMs": 54,
  "rows": [
    { "id": 530, "name": "Acme" },
    { "id": 470, "name": "Globex" }
  ]
}
```

`Date`, `RegExp`, `ObjectId`, `BigInt` and `Buffer` are serialised readably — without that the consumer would receive `{}` where an id should be, which is worse than an error because it looks like valid data.

**Table**, for human eyes:

```bash
dbq -e dev -d mysql -f table "SELECT id, name FROM companies"
```

```
id   name
---  ------
530  Acme
470  Globex

2 row(s) in 49ms — my-project/dev/mysql
```

Colour appears only with `--format table` **and** stdout being a TTY. JSON never receives ANSI: one escape byte would break the consumer's `JSON.parse`.

---

## Exit codes

Each code implies a different corrective action — that is what lets an agent choose its next step without parsing prose:

| Code | Meaning | What to do |
|---|---|---|
| `0` | success | — |
| `1` | unexpected | — |
| `2` | invalid usage | fix the invocation |
| `3` | refused by the guard | rewrite the query |
| `4` | connection / authentication | check `--env`, credentials, VPN |
| `5` | database error | check with `dbq schema` |
| `6` | timeout | filter harder, or raise `--timeout` |

Errors go to **stderr**, in the same format as the output:

```json
{
  "error": {
    "code": "READONLY_VIOLATION",
    "message": "operator '$out' is not allowed: it writes data or runs JavaScript on the server",
    "hint": "read operations: find, findOne, aggregate, countDocuments, estimatedDocumentCount, distinct; …"
  }
}
```

The `hint` field is deliberate: it is what makes the second attempt correct instead of the fifth.

**Credentials never reach an error message.** Drivers love echoing the whole connection string, password included, when authentication fails — the URI is scrubbed before any byte reaches stderr.

> Exit codes and the `error.code` field are the stable contract — key on those, never on the message prose.

---

## How it works

```
argv → resolveProject → loadEnv → guard → engine → envelope → stdout
```

```
src/
  cli.ts            argv, orchestration, error → exit code
  config/           resolves the project from cwd; reads and validates the env file
  guards/           validates the query      (pure functions, zero I/O)
  engines/          executes what was approved
  schema/           discovery of tables, collections and databases
  output/           truncation and formatting
  errors.ts         DbqError, exit codes, credential scrubbing
```

**The boundary the whole project rests on: guards never open a connection, engines never see raw input.**

The engine receives an already-validated structure — a collection, an operation drawn from a whitelist, arguments already proven to be literals. There is no code path where a user-supplied string reaches the driver without crossing the guard.

Two practical consequences:

1. **Read-only is structural, not hopeful.** A destructive query against production dies in the parser, before the network is touched.
2. **The guards are pure functions**, so the suite protecting the guarantee runs with no database at all — which is why it can be exhaustive.

Every decision, with the alternatives that were rejected and why, is written up in [docs/specs/2026-09-03-dbq-design.md](docs/specs/2026-09-03-dbq-design.md).

---

## Recipes

**Count before listing**, to learn whether the data is worth fetching:

```bash
dbq -e dev -d mongo 'db.orders.countDocuments({ status: "pending" })'
```

**Explore an unfamiliar table:**

```bash
dbq schema -e dev -d mysql                        # what tables exist
dbq schema -e dev -d mysql orders                 # what columns it has
dbq -e dev -d mysql -l 5 "SELECT * FROM orders"   # what the data looks like
```

**Compare environments** (fish):

```fish
for env in dev staging production
  dbq -e $env -d mysql "SELECT COUNT(*) AS n FROM companies"
end
```

**Long query from a file:**

```bash
dbq -e dev -d mysql - < report.sql
```

**Pull one field out with `jq`:**

```bash
dbq -e dev -d mongo 'db.plans.find({}, { name: 1 })' | jq -r '.rows[].name'
```

**Check whether a query would be accepted, without running it:** invoke it against any environment. Exit `3` means the guard refused — and no connection was ever opened.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `has mode 644; expected 600` | run `chmod 600` on the env file |
| `could not infer the project` | you are outside the repo; pass `--project` |
| `env 'dev' has several connections` | pass `--db <connection>` |
| `no database defined for this connection` | pass `-D <name>`, or declare `database` in the file |
| `'schema' is a subcommand, not a query` | subcommands come before flags |
| exit `4` with `ETIMEDOUT` | VPN disconnected, or host unreachable |
| exit `6` | query too heavy; filter harder or raise `--timeout` |
| fewer results than expected | check `truncated` in the output; raise `--limit` |

Resolution errors **list the alternatives** in the message itself — an uninferred project lists the projects, a missing environment lists the environments, an undefined database lists the cluster's databases. The corrected invocation falls straight out of the error.

---

## Development

```bash
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
```

The adversarial suite in `tests/guards/` is the project's invariant: not one of its cases may be skipped or marked `.skip` to unblock a build.

Before touching the code, read **[AGENTS.md](AGENTS.md)** — architecture, the guard/engine boundary, type-stripping constraints, and where each kind of code belongs.

Documents: [AGENTS.md](AGENTS.md) · [design](docs/specs/2026-09-03-dbq-design.md) · [implementation plan](docs/plans/2026-09-03-dbq.md)

---

## Scope

**In:** MySQL, PostgreSQL, MongoDB, read queries, schema discovery, per-project and per-environment configuration.

**Out:** Redis, OpenSearch, writes of any kind, interactive prompts.

Redis was considered and deliberately left out: it has no query language, no
schema and no rows, so `schema` and the row ceiling have no meaning there — and
its real hazard is not writing but `KEYS *` blocking a single-threaded server.

`${VAR}` expansion in URIs — to keep production passwords out of plaintext — is noted as a v2 candidate.
