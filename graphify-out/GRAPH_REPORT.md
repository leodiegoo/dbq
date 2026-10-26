# Graph Report - dbq  (2026-10-26)

## Corpus Check
- 47 files · ~37,222 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: (none) 2, .lock 1)

## Summary
- 348 nodes · 693 edges · 16 communities (14 shown, 2 thin omitted)
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 56 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d4236661`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- errors.ts
- loadEnv.ts
- package.json
- dbq
- cli.ts
- dbq — a read-only query runner for MySQL, PostgreSQL and MongoDB
- guards/types.ts
- dbq — Knowledge Base
- compilerOptions
- mysql.test.ts
- engines/redis.ts
- DbqError
- AXI audit and output measurements
- vitest.config.ts
- pull_request_template.md

## God Nodes (most connected - your core abstractions)
1. `DbqError` - 48 edges
2. `toDbqError()` - 22 edges
3. `dbq — a read-only query runner for MySQL, PostgreSQL and MongoDB` - 20 edges
4. `dbq` - 17 edges
5. `dbq Implementation Plan` - 17 edges
6. `toConnectionError()` - 15 edges
7. `applyLimit()` - 15 edges
8. `vitest` - 13 edges
9. `executeMysql()` - 13 edges
10. `compilerOptions` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Output` --references--> `scrubUri()`  [INFERRED]
  AGENTS.md → src/errors.ts
- `Anti-patterns` --references--> `applyLimit()`  [INFERRED]
  AGENTS.md → src/output/envelope.ts
- `Tests` --references--> `applyLimit()`  [INFERRED]
  AGENTS.md → src/output/envelope.ts
- `Style` --references--> `DbqError`  [INFERRED]
  AGENTS.md → src/errors.ts
- `File Structure` --references--> `DbqError`  [INFERRED]
  docs/plans/2026-09-03-dbq.md → src/errors.ts

## Import Cycles
- None detected.

## Communities (16 total, 2 thin omitted)

### Community 0 - "errors.ts"
Cohesion: 0.11
Nodes (39): Errors and exit codes, Global Constraints, Self-Review, Task 10: Engine MongoDB, Task 11: Descoberta de schema, Task 9: Engine MySQL, mongodb, ref_mysql2_promise (+31 more)

### Community 1 - "loadEnv.ts"
Cohesion: 0.10
Nodes (28): File Structure, Task 7: Loading and validating the env file, ref_node_child_process, ref_node_fs, ref_node_fs_promises, ref_node_os, ref_node_path, vitest (+20 more)

### Community 2 - "package.json"
Cohesion: 0.05
Nodes (38): bin, dbq, dependencies, acorn, commander, mongodb, mysql2, pg (+30 more)

### Community 3 - "dbq"
Cohesion: 0.06
Nodes (33): Configuration, Contents, Creating your first file, dbq, Development, Discovery: `envs`, `databases`, `schema`, Exit codes, Fields (+25 more)

### Community 4 - "cli.ts"
Cohesion: 0.14
Nodes (23): samples, CommonOptions, configureErrors(), emit(), fail(), Format, handleCliError(), integer() (+15 more)

### Community 5 - "dbq — a read-only query runner for MySQL, PostgreSQL and MongoDB"
Cohesion: 0.07
Nodes (29): Architecture, CLI surface, Configuration, Configuration precedence, Credential hygiene, Data flow, dbq — a read-only query runner for MySQL, PostgreSQL and MongoDB, Discovery subcommands (+21 more)

### Community 6 - "guards/types.ts"
Cohesion: 0.10
Nodes (29): Style, Revision of 2026-09-22 — bounded Redis inspection, acorn, AnyNode, Call, guardMongo(), isNode(), readModifier() (+21 more)

### Community 7 - "dbq — Knowledge Base"
Cohesion: 0.12
Nodes (14): Anti-patterns, Architecture, Conventions, dbq — Knowledge Base, Documentation, Errors that list alternatives, Flow, Output (+6 more)

### Community 8 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleResolution, noEmit, noUncheckedIndexedAccess (+6 more)

### Community 9 - "mysql.test.ts"
Cohesion: 0.22
Nodes (6): ref_node_events, connection, created, FakeClient, opts, plan

### Community 10 - "engines/redis.ts"
Cohesion: 0.31
Nodes (9): redis, RedisConnection, cappedRangeArgs(), executeRedis(), pairs(), RedisExecuteOptions, RedisExecuteResult, scanRows() (+1 more)

### Community 11 - "DbqError"
Cohesion: 0.11
Nodes (23): dbq Implementation Plan, Task 12: Montagem da CLI, Task 13: Installation, README and manual smoke test, Task 1: Project scaffold, Task 2: Erros e exit codes, Task 3: Contrato entre guards e engines, Task 4: Guard do SQL, Task 5: Guard do MongoDB (+15 more)

### Community 12 - "AXI audit and output measurements"
Cohesion: 0.29
Nodes (6): AXI audit and output measurements, Migrating consumers to TOON, Observed CLI output, Principle-by-principle audit, Reference implementations checked, Token measurements

### Community 15 - "pull_request_template.md"
Cohesion: 0.40
Nodes (4): Checklist, Evidence, Merge Danger, Summary

## Knowledge Gaps
- **145 isolated node(s):** `name`, `version`, `description`, `type`, `dbq` (+140 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 162 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DbqError` connect `DbqError` to `errors.ts`, `loadEnv.ts`, `cli.ts`, `guards/types.ts`, `engines/redis.ts`?**
  _High betweenness centrality (0.182) - this node is a cross-community bridge._
- **Why does `dbq` connect `dbq` to `dbq — Knowledge Base`?**
  _High betweenness centrality (0.159) - this node is a cross-community bridge._
- **Why does `dbq Implementation Plan` connect `DbqError` to `errors.ts`, `loadEnv.ts`, `dbq — Knowledge Base`?**
  _High betweenness centrality (0.156) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `DbqError` (e.g. with `Style` and `File Structure`) actually correct?**
  _`DbqError` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `toDbqError()` (e.g. with `Errors and exit codes` and `Task 10: Engine MongoDB`) actually correct?**
  _`toDbqError()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _145 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `errors.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10726950354609929 - nodes in this community are weakly interconnected._