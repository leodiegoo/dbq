# Graph Report - dbq  (2026-11-16)

## Corpus Check
- 55 files · ~39,529 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 4, .lock 1)

## Summary
- 401 nodes · 743 edges · 22 communities (19 shown, 3 thin omitted)
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 56 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1b5bc93b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- DbqError
- loadEnv.ts
- package.json
- dbq
- cli.ts
- dbq — a read-only query runner for MySQL, PostgreSQL and MongoDB
- guards/types.ts
- engines/mysql.ts
- compilerOptions
- mysql.test.ts
- engines/redis.ts
- sql.ts
- AXI audit and output measurements
- vitest.config.ts
- pull_request_template.md
- compilerOptions
- release-please-config.json
- biome.json
- guards/redis.ts
- dependencies
- engines/postgres.ts

## God Nodes (most connected - your core abstractions)
1. `DbqError` - 48 edges
2. `dbq — a read-only query runner for MySQL, PostgreSQL and MongoDB` - 23 edges
3. `toDbqError()` - 22 edges
4. `dbq` - 18 edges
5. `dbq Implementation Plan` - 17 edges
6. `toConnectionError()` - 15 edges
7. `applyLimit()` - 15 edges
8. `vitest` - 13 edges
9. `executeMysql()` - 13 edges
10. `compilerOptions` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Task 2: Erros e exit codes` --references--> `DbqError`  [INFERRED]
  docs/plans/2026-09-03-dbq.md → src/errors.ts
- `Task 6: Configuration types and project resolution` --references--> `DbqError`  [INFERRED]
  docs/plans/2026-09-03-dbq.md → src/errors.ts
- `Task 8: Output envelope` --references--> `DbqError`  [INFERRED]
  docs/plans/2026-09-03-dbq.md → src/errors.ts
- `Global Constraints` --references--> `scrubUri()`  [INFERRED]
  docs/plans/2026-09-03-dbq.md → src/errors.ts
- `Style` --references--> `DbqError`  [INFERRED]
  AGENTS.md → src/errors.ts

## Import Cycles
- None detected.

## Communities (22 total, 3 thin omitted)

### Community 0 - "DbqError"
Cohesion: 0.12
Nodes (28): Conventions, Errors and exit codes, Errors that list alternatives, Output, TypeScript under type stripping, mongodb, ceiling(), executeMongo() (+20 more)

### Community 1 - "loadEnv.ts"
Cohesion: 0.10
Nodes (28): File Structure, Task 7: Loading and validating the env file, ref_node_child_process, ref_node_fs, ref_node_fs_promises, ref_node_os, ref_node_path, vitest (+20 more)

### Community 2 - "package.json"
Cohesion: 0.05
Nodes (40): bin, dbq, description, devDependencies, @biomejs/biome, @types/node, @types/pg, @types/pg-cursor (+32 more)

### Community 3 - "dbq"
Cohesion: 0.06
Nodes (36): Configuration, Contents, Creating your first file, dbq, Development, Discovery: `envs`, `databases`, `schema`, Exit codes, Fields (+28 more)

### Community 4 - "cli.ts"
Cohesion: 0.14
Nodes (23): samples, CommonOptions, configureErrors(), emit(), fail(), Format, handleCliError(), integer() (+15 more)

### Community 5 - "dbq — a read-only query runner for MySQL, PostgreSQL and MongoDB"
Cohesion: 0.06
Nodes (32): Architecture, CLI surface, Configuration, Configuration precedence, Credential hygiene, Data flow, dbq — a read-only query runner for MySQL, PostgreSQL and MongoDB, Discovery subcommands (+24 more)

### Community 6 - "guards/types.ts"
Cohesion: 0.17
Nodes (18): Style, Task 5: Guard do MongoDB, AnyNode, Call, guardMongo(), isNode(), readModifier(), refuse() (+10 more)

### Community 7 - "engines/mysql.ts"
Cohesion: 0.08
Nodes (35): Anti-patterns, Architecture, dbq — Knowledge Base, Documentation, Flow, Quick Start, Tests, The boundary the project rests on (+27 more)

### Community 8 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleResolution, noEmit, noUncheckedIndexedAccess (+6 more)

### Community 9 - "mysql.test.ts"
Cohesion: 0.22
Nodes (6): ref_node_events, connection, created, FakeClient, opts, plan

### Community 10 - "engines/redis.ts"
Cohesion: 0.24
Nodes (11): Revision of 2026-09-22 — bounded Redis inspection, redis, RedisConnection, cappedRangeArgs(), executeRedis(), pairs(), RedisExecuteOptions, RedisExecuteResult (+3 more)

### Community 11 - "sql.ts"
Cohesion: 0.39
Nodes (6): ALLOWED_LEADING, FORBIDDEN_FRAGMENTS, guardSql(), normalize(), refuse(), refuses()

### Community 12 - "AXI audit and output measurements"
Cohesion: 0.29
Nodes (6): AXI audit and output measurements, Migrating consumers to TOON, Observed CLI output, Principle-by-principle audit, Reference implementations checked, Token measurements

### Community 15 - "pull_request_template.md"
Cohesion: 0.40
Nodes (4): Checklist, Evidence, Merge Danger, Summary

### Community 16 - "compilerOptions"
Cohesion: 0.20
Nodes (9): ./tsconfig.json, compilerOptions, allowImportingTsExtensions, noEmit, outDir, rewriteRelativeImportExtensions, rootDir, extends (+1 more)

### Community 18 - "biome.json"
Cohesion: 0.11
Nodes (18): assist, enabled, files, includes, formatter, indentStyle, indentWidth, lineWidth (+10 more)

### Community 19 - "guards/redis.ts"
Cohesion: 0.33
Nodes (9): guardRedis(), isCursor(), isInteger(), refuse(), SIMPLE_ARITY, validateScan(), REDIS_READ_COMMANDS, RedisReadCommand (+1 more)

### Community 20 - "dependencies"
Cohesion: 0.20
Nodes (10): dependencies, acorn, commander, mongodb, mysql2, pg, pg-cursor, picocolors (+2 more)

### Community 21 - "engines/postgres.ts"
Cohesion: 0.33
Nodes (8): pg, pg-cursor, PostgresConnection, executePostgres(), withDatabase(), postgresDatabases(), postgresSchema(), quote()

## Knowledge Gaps
- **181 isolated node(s):** `$schema`, `enabled`, `clientKind`, `useIgnoreFile`, `includes` (+176 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 198 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DbqError` connect `DbqError` to `loadEnv.ts`, `cli.ts`, `guards/types.ts`, `engines/mysql.ts`, `engines/redis.ts`, `sql.ts`, `guards/redis.ts`, `engines/postgres.ts`?**
  _High betweenness centrality (0.149) - this node is a cross-community bridge._
- **Why does `dbq` connect `dbq` to `dbq — a read-only query runner for MySQL, PostgreSQL and MongoDB`?**
  _High betweenness centrality (0.139) - this node is a cross-community bridge._
- **Why does `dbq Implementation Plan` connect `engines/mysql.ts` to `loadEnv.ts`, `dbq — a read-only query runner for MySQL, PostgreSQL and MongoDB`, `guards/types.ts`?**
  _High betweenness centrality (0.133) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `DbqError` (e.g. with `Style` and `File Structure`) actually correct?**
  _`DbqError` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `toDbqError()` (e.g. with `Errors and exit codes` and `Task 10: Engine MongoDB`) actually correct?**
  _`toDbqError()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `$schema`, `enabled`, `clientKind` to the rest of the system?**
  _181 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `DbqError` be split into smaller, more focused modules?**
  _Cohesion score 0.12436974789915967 - nodes in this community are weakly interconnected._