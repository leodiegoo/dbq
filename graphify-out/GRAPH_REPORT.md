# Graph Report - dbq  (2026-11-05)

## Corpus Check
- 49 files · ~38,562 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: (none) 3)

## Summary
- 378 nodes · 721 edges · 18 communities (15 shown, 3 thin omitted)
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 56 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `dd60f6c1`
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
- compilerOptions
- release-please-config.json

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
- `Output` --references--> `scrubUri()`  [INFERRED]
  AGENTS.md → src/errors.ts
- `Global Constraints` --references--> `scrubUri()`  [INFERRED]
  docs/plans/2026-09-03-dbq.md → src/errors.ts
- `Anti-patterns` --references--> `applyLimit()`  [INFERRED]
  AGENTS.md → src/output/envelope.ts
- `Tests` --references--> `applyLimit()`  [INFERRED]
  AGENTS.md → src/output/envelope.ts
- `Task 7: Loading and validating the env file` --references--> `listEnvs()`  [INFERRED]
  docs/plans/2026-09-03-dbq.md → src/config/resolveProject.ts

## Import Cycles
- None detected.

## Communities (18 total, 3 thin omitted)

### Community 0 - "errors.ts"
Cohesion: 0.10
Nodes (41): Errors and exit codes, Self-Review, Task 10: Engine MongoDB, Task 11: Descoberta de schema, Task 9: Engine MySQL, mongodb, ref_mysql2_promise, DEFAULT_LIMIT (+33 more)

### Community 1 - "loadEnv.ts"
Cohesion: 0.12
Nodes (20): ref_node_child_process, ref_node_fs, ref_node_fs_promises, ref_node_os, ref_node_path, vitest, resolve(), isRecord() (+12 more)

### Community 2 - "package.json"
Cohesion: 0.04
Nodes (47): bin, dbq, dependencies, acorn, commander, mongodb, mysql2, pg (+39 more)

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
Cohesion: 0.11
Nodes (28): Style, Revision of 2026-09-22 — bounded Redis inspection, acorn, AnyNode, Call, guardMongo(), isNode(), readModifier() (+20 more)

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
Cohesion: 0.09
Nodes (30): dbq Implementation Plan, File Structure, Global Constraints, Task 12: Montagem da CLI, Task 13: Installation, README and manual smoke test, Task 1: Project scaffold, Task 2: Erros e exit codes, Task 3: Contrato entre guards e engines (+22 more)

### Community 12 - "AXI audit and output measurements"
Cohesion: 0.29
Nodes (6): AXI audit and output measurements, Migrating consumers to TOON, Observed CLI output, Principle-by-principle audit, Reference implementations checked, Token measurements

### Community 15 - "pull_request_template.md"
Cohesion: 0.40
Nodes (4): Checklist, Evidence, Merge Danger, Summary

### Community 16 - "compilerOptions"
Cohesion: 0.20
Nodes (9): ./tsconfig.json, compilerOptions, allowImportingTsExtensions, noEmit, outDir, rewriteRelativeImportExtensions, rootDir, extends (+1 more)

## Knowledge Gaps
- **166 isolated node(s):** `name`, `version`, `description`, `type`, `type` (+161 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 183 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DbqError` connect `DbqError` to `errors.ts`, `loadEnv.ts`, `cli.ts`, `guards/types.ts`, `engines/redis.ts`?**
  _High betweenness centrality (0.165) - this node is a cross-community bridge._
- **Why does `dbq` connect `dbq` to `dbq — Knowledge Base`?**
  _High betweenness centrality (0.155) - this node is a cross-community bridge._
- **Why does `dbq Implementation Plan` connect `DbqError` to `errors.ts`, `dbq — Knowledge Base`?**
  _High betweenness centrality (0.148) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `DbqError` (e.g. with `Style` and `File Structure`) actually correct?**
  _`DbqError` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `toDbqError()` (e.g. with `Errors and exit codes` and `Task 10: Engine MongoDB`) actually correct?**
  _`toDbqError()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _166 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `errors.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10352941176470588 - nodes in this community are weakly interconnected._