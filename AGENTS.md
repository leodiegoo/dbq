# dbq — Knowledge Base

**Stack**: TypeScript executado direto pelo Node 26 (type stripping nativo, sem build) + Commander + mysql2 + mongodb + acorn + Vitest + pnpm

CLI read-only de queries SQL e MongoDB. O consumidor principal é um **agente de IA**, não uma pessoa — isso inverte prioridades usuais de CLI e explica quase todo o design.

## Quick Start

```bash
pnpm install
pnpm test          # vitest
pnpm typecheck     # tsc --noEmit
npm link           # instala o binário `dbq` no PATH
node src/cli.ts --help
```

Não há passo de build. O `bin` do `package.json` aponta para `src/cli.ts`.

## A invariante

**O `dbq` não escreve. Nunca.**

Não existe flag, variável de ambiente ou campo de config que destrave escrita. Não é um default — é uma propriedade estrutural, garantida por validação que roda **antes de qualquer conexão ser aberta**.

Toda decisão neste repositório deriva daí. Se uma mudança enfraquece essa invariante, ela está errada, mesmo que os testes passem.

Consequência que vale internalizar: `dbq -e production 'db.plans.drop()'` sai com exit 3 **sem tocar a rede**. O guard roda antes do engine.

## Arquitetura

```
src/
  cli.ts                  argv, orquestração, impressão, tradução de erro → exit code
  config/
    types.ts              Connection, EnvConfig, ResolvedConnection, defaults
    resolveProject.ts     raiz XDG, listagem, detecção do projeto pelo cwd
    loadEnv.ts            lê/valida o arquivo da env, resolve --db e --database
  guards/
    types.ts              SqlPlan, MongoPlan — o contrato guard → engine
    sql.ts                valida string SQL       (puro, zero I/O)
    mongo.ts              parseia AST via acorn   (puro, zero I/O)
  engines/
    mysql.ts              executa o que o guard aprovou; trunca em stream
    mongo.ts              idem; aplica limit(n+1) e maxTimeMS
  schema/
    mysql.ts              SHOW TABLES / DESCRIBE
    mongo.ts              listCollections / shape inferido por amostra
  output/
    envelope.ts           truncamento, JSON serializável, tabela, erro
  errors.ts               DbqError, códigos → exit codes, scrubUri
```

### A fronteira que sustenta o projeto

**Guards nunca abrem conexão. Engines nunca veem input cru.**

O engine recebe uma estrutura já validada — uma coleção, uma operação vinda de um whitelist, argumentos já provados literais. Não existe caminho de código no qual uma string do usuário alcance o driver sem atravessar o guard.

É isso que torna o read-only estrutural em vez de otimista, e é por isso que os guards são funções puras: a suíte que protege a invariante roda sem banco nenhum.

**Ao mexer aqui:** se você se pegar passando uma string crua para dentro de `engines/`, pare. O tipo certo é `SqlPlan` ou `MongoPlan`.

### Fluxo

```
argv → resolveProject → loadEnv → guard → engine → envelope → stdout
```

## Convenções

### TypeScript sob type stripping

O Node apaga tipos em runtime, mas **não transforma código**. Isso proíbe:

- `enum` — use `as const` + `(typeof X)[keyof typeof X]`
- `namespace`
- parameter properties (`constructor(private x: string)`)
- decorators

O `tsconfig` liga `erasableSyntaxOnly`, então `pnpm typecheck` falha se alguém escorregar. Imports internos **carregam extensão explícita**: `import { guardSql } from './guards/sql.ts'`.

### Estilo

- **Named exports apenas** — nunca `export default`. A única exceção é `vitest.config.ts`, que o Vitest exige.
- **ESM** (`"type": "module"`).
- **Arrow functions** para módulos; `class` só para `DbqError`.
- **Comentários explicam o porquê, não o quê.** Os comentários existentes marcam decisões não óbvias (por que `ETIMEDOUT` é checado antes de `ECONNREFUSED`, por que a interpolação de identificador em `schema/mysql.ts` é segura). Mantenha esse padrão — não comente o óbvio.
- **Derivar unions de objetos** em vez de declarar à mão. Veja `MONGO_READ_OPS` / `MongoReadOp` em `guards/types.ts`.

### Saída

- **JSON nunca recebe ANSI.** Cor só com `--format table` **e** `process.stdout.isTTY`. Um byte de escape em JSON quebra o `JSON.parse` do consumidor.
- **Nada bloqueia esperando TTY.** Sem prompts, sem spinners — um comando que *pendura* é o pior modo de falha para uma ferramenta automatizada. Por isso `@clack/prompts` e `ora` foram deliberadamente descartados.
- **Erro sempre traz `hint` acionável.** É o campo que faz o agente acertar na segunda tentativa em vez de tentar cinco variações.
- **Credencial nunca alcança stderr.** Toda mensagem passa por `scrubUri`. Drivers adoram ecoar a connection string inteira ao falhar auth.

### Erros e exit codes

Códigos distintos porque cada um implica uma ação corretiva diferente:

| Código | `DbqErrorCode` | Ação implicada |
|---|---|---|
| 0 | — | — |
| 1 | `UNEXPECTED` | — |
| 2 | `USAGE` | corrigir a invocação |
| 3 | `READONLY_VIOLATION` | reescrever a query |
| 4 | `CONNECTION_ERROR` | conferir `--env` e rede |
| 5 | `DATABASE_ERROR` | conferir com `dbq schema` |
| 6 | `TIMEOUT` | filtrar mais |

Use `toConnectionError` — e não `toDbqError` — para qualquer falha levantada **enquanto a conexão ainda está abrindo**. Sem isso, um `connect ETIMEDOUT` vira `TIMEOUT` e o consumidor recebe "reduza o escopo da query" para um socket que nem abriu.

### Erros que listam alternativas

Quando o `dbq` não consegue resolver algo, ele **não chuta**: falha e coloca as alternativas no texto do erro. Projeto não inferido lista os projetos; env inexistente lista as envs; banco não definido lista os bancos do cluster. Mantenha esse padrão em qualquer resolução nova — é o que transforma um erro em uma reinvocação certeira.

## Testes

Vitest, com o peso onde está o risco.

```bash
pnpm test
pnpm vitest run tests/guards/    # só a suíte que protege a invariante
```

- **Nomes começam com `it should be` / `it should when`.**
- **`tests/guards/` é inegociável.** São dois corpora: queries que precisam passar e um corpus adversarial que precisa ser recusado (`$out` aninhado em `$facet`, `db["dr"+"op"]()`, `;DROP`, `DROP` atrás de comentário, `INTO OUTFILE`, `$where` dentro de `$and`, encadeamento fora do whitelist). Nenhum caso pode ser pulado ou marcado como skip para desbloquear build — essa suíte **é** a invariante.
- **Todo furo descoberto vira teste antes de virar correção.**
- Engines não têm teste unitário: são quase inteiramente I/O. O que é testável neles — truncamento — vive em `applyLimit`, coberto em `tests/output/`.

## Onde adicionar código

| O que | Onde | Não esqueça |
|---|---|---|
| Nova operação de leitura do Mongo | `MONGO_READ_OPS` em `guards/types.ts` + `case` no switch de `engines/mongo.ts` | teste no corpus que passa |
| Novo operador proibido | `FORBIDDEN_KEYS` em `guards/types.ts` | teste adversarial, inclusive aninhado |
| Novo fragmento SQL proibido | `FORBIDDEN_FRAGMENTS` em `guards/sql.ts` | teste adversarial |
| Novo subcomando | `src/cli.ts` + array `SUBCOMMANDS` | o array alimenta a recusa de subcomando-como-query |
| Novo engine (Postgres, etc.) | `src/engines/<nome>.ts` + guard próprio em `src/guards/` | o guard vem **primeiro**, com corpus adversarial |
| Novo campo de config | `src/config/types.ts` + validação em `loadEnv.ts` | teste de precedência flag > arquivo > embutido |

## Anti-patterns

**NUNCA:**

- Adicionar flag, env var ou campo que permita escrita.
- Usar `eval`, `new Function` ou `vm` para interpretar query — o guard do Mongo é AST **parseada**, jamais avaliada; foi a decisão de design mais importante do projeto.
- Passar string crua do usuário para dentro de `engines/`.
- Reordenar `argv` por conta própria para "consertar" ordem de subcomando — quebra para quem tiver conexão com o mesmo nome.
- Escrever ANSI em stdout quando o formato é JSON.
- Interpolar valor do usuário em SQL. A única interpolação existente (`schema/mysql.ts`) é precedida de uma allowlist `^[A-Za-z0-9_$]+$`; se você precisar de outra, replique a allowlist ou não interpole.
- Deletar ou pular teste para fazer build passar.

**Cuidado com:**

- `applyLimit` é teto, não substituição. Query que já pede menos continua mandando.
- Engines buscam `n + 1` linhas de propósito — é assim que `truncated` é detectado sem um `COUNT` extra.
- O path da URI **nunca** define o banco. Só o campo `database` e a flag `-D`.

## Documentação

| Documento | O quê |
|---|---|
| [README.md](README.md) | uso, configuração, o que é permitido |
| [docs/specs/2026-09-03-dbq-design.md](docs/specs/2026-09-03-dbq-design.md) | o design e o **porquê** de cada decisão, com as alternativas descartadas |
| [docs/plans/2026-09-03-dbq.md](docs/plans/2026-09-03-dbq.md) | o plano de implementação, task a task |

A spec tem uma tabela de decisões no fim e uma revisão datada sobre o `--database`. **Leia a spec antes de mudar comportamento** — várias escolhas que parecem arbitrárias têm uma alternativa já considerada e descartada por um motivo registrado.

Se você mudar uma decisão de design, **atualize a spec com uma revisão datada** em vez de reescrever a original. O histórico do raciocínio vale mais do que um documento sempre "limpo".
