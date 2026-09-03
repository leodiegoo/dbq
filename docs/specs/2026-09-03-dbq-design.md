# dbq — executor de queries read-only para SQL e MongoDB

- **Data:** 2026-09-03
- **Status:** aprovado, pronto para plano de implementação
- **Repositório:** `~/Developer/personal/dbq`

## Objetivo

Uma CLI que executa queries de leitura contra MySQL e MongoDB, configurada por
arquivos de ambiente em `~/.config/dbq/`, projetada para ser invocada por um
agente de IA a partir de qualquer diretório.

O consumidor principal não é humano. Isso inverte duas prioridades usuais de
CLI: a saída é otimizada para ser parseada e para não estourar contexto, e
nenhum caminho de execução pode bloquear esperando input interativo.

## Invariante central

**O `dbq` não escreve. Nunca.**

Não existe flag, variável de ambiente ou arquivo de config que destrave escrita.
Isso não é um default — é uma propriedade estrutural do programa, garantida por
validação que acontece antes de qualquer conexão ser aberta.

Todas as decisões abaixo derivam dessa invariante. Qualquer mudança futura que a
enfraqueça invalida este design e exige uma revisão nova.

## Escopo

**Dentro:** MySQL e MongoDB; queries de leitura; descoberta de schema; config
por projeto e ambiente; saída JSON e tabela.

**Fora (MVP):** PostgreSQL, OpenSearch, Redis; escrita de qualquer natureza;
expansão de `${VAR}` nas URIs (anotado como possível v2 — no MVP a URI é texto
puro); publicação no npm; qualquer prompt interativo.

## Arquitetura

```
src/
  cli.ts                  parse de argv, orquestração, impressão (fino)
  config/
    resolveProject.ts     cwd → raiz do git → basename, ou --project
    loadEnv.ts            lê e valida o arquivo da env, resolve --db
  guards/
    sql.ts                valida string SQL (puro, sem I/O)
    mongo.ts              parseia db.<col>.<op>(...) via AST (puro, sem I/O)
  engines/
    mysql.ts              executa o que o guard aprovou
    mongo.ts              idem
  output/
    envelope.ts           resultado → JSON ou tabela
```

### A fronteira que sustenta o projeto

**Guards nunca abrem conexão. Engines nunca veem input cru.**

O engine recebe uma estrutura já validada — uma coleção, uma operação vinda de
um whitelist, argumentos que já foram provados literais. Não existe caminho de
código no qual uma string fornecida pelo usuário alcance o driver sem atravessar
o guard.

Consequência prática: os guards são funções puras, testáveis exaustivamente sem
banco nenhum. É onde mora o risco e é onde mora a suíte de testes.

### Fluxo de dados

```
argv → resolveProject → loadEnv → guard → engine → envelope → stdout
```

## Stack

```
typescript      tipos; checagem via `tsc --noEmit`, nunca em runtime
commander       comandos, flags, --help gerado automaticamente
mysql2          driver SQL
mongodb         driver Mongo
acorn           AST para o guard do Mongo
picocolors      cor, exclusivamente em --format table com stdout TTY
vitest          testes
pnpm            gerenciador de pacotes
```

**Sem passo de build.** Node 26 executa `.ts` diretamente via type stripping
nativo (verificado na máquina alvo). O `bin` do `package.json` aponta para
`src/cli.ts` com shebang `#!/usr/bin/env node`; instalação via `npm link` durante
o desenvolvimento.

Disciplina exigida pelo type stripping: nada de `enum`, `namespace` ou parameter
properties, e imports internos carregam extensão explícita (`./guards/sql.ts`).

**Sem `@clack/prompts` e sem `ora`.** Ambos servem sessão interativa, que é
precisamente o que o `dbq` não é. Um prompt bloqueia esperando um TTY que não
existe quando a IA invoca — o comando não falha, ele pendura, o pior modo de
falha para uma ferramenta automatizada. Um spinner escreve escape de cursor em
stdout e contamina saída destinada a `JSON.parse`. Nenhum fluxo deste design
precisa perguntar nada.

**Commander apesar do tamanho pequeno da superfície.** O `--help` gerado
automaticamente e sempre em sincronia com as flags reais é o que um agente lê ao
encontrar um binário desconhecido. Isso vale mais que as poucas linhas de
`util.parseArgs` que ele substitui.

## Configuração

### Localização

```
~/.config/dbq/<projeto>/<env>.json
```

Respeita `$XDG_CONFIG_HOME` quando definido. O `dbq` é dono do próprio diretório
em vez de espalhar nomes de projeto direto em `~/.config/`, que é território
compartilhado com `nvim`, `gh`, `fish` e outros — colisão de nome entre um
projeto pessoal e uma ferramenta real é questão de tempo.

### Formato

```json
{
  "connections": {
    "mongo": {
      "engine": "mongodb",
      "uri": "mongodb://user:senha@host:27017/appdb",
      "database": "appdb"
    },
    "mysql": {
      "engine": "mysql",
      "uri": "mysql://leitura:senha@10.0.0.1:3306/appdb"
    }
  },
  "defaults": { "limit": 500, "timeoutMs": 30000 }
}
```

Um arquivo de env agrupa **N conexões nomeadas**, porque um ambiente real não é
um banco só — no my-project, `dev` é MongoDB e MySQL simultaneamente. Trocar de
ambiente permanece uma ação única, e `--env` fica sendo o eixo explícito e ruidoso
que separa dev de produção.

`--db` é opcional quando a env declara uma única conexão.

O campo `database` é o banco **default** da conexão, e é opcional. Um nome de
banco presente no path da URI é sempre ignorado.

**Revisão de 2026-09-03**, depois do primeiro uso real: a versão original exigia
`database` no arquivo e o tratava como única fonte de verdade. Um cluster
hospeda vários bancos — o de dev tem sete — então fixar um por arquivo obrigava
a criar uma conexão nomeada por banco. A flag `-D, --database` passou a
sobrescrever o default por invocação.

A razão da regra original continua valendo: ela existia para impedir que dois
lugares *implícitos* (campo e path da URI) discordassem. Uma flag explícita não
é ambiguidade, é override — e o path da URI segue ignorado.

Quando nem o campo nem a flag resolvem um banco, o erro lista os bancos do
cluster, do mesmo modo que o erro de projeto lista os projetos.

### Higiene de credenciais

- O `dbq` **recusa executar** se o arquivo de env não estiver em modo `0600`, com
  mensagem informando como corrigir. Esses arquivos guardam senha de produção.
- Recomendação operacional (não é código): apontar as URIs para um usuário
  **read-only no próprio banco**. O guard protege de erro humano; o usuário do
  banco protege de bug no guard.

### Resolução de projeto

O `dbq` sobe do cwd até a raiz do repositório git e usa o basename do diretório.
Se não houver correspondência em `~/.config/dbq/`, **falha** — com a lista dos
projetos disponíveis no texto do erro, para que a reinvocação com `--project`
seja imediata. Nunca chuta, nunca cai em default.

`--project` sobrescreve a detecção. Não existe "projeto ativo" persistido em
lugar nenhum: estado global invisível é como se acerta o comando e se erra o
banco.

## Superfície da CLI

```bash
dbq --env dev "SELECT id, name FROM companies WHERE active = 1"
dbq --env dev --db mongo 'db.companies.find({ active: true }).limit(10)'
dbq --project my-project --env prod --db mysql "SHOW TABLES"
cat pipeline.js | dbq --env dev --db mongo -
```

| Flag | Default | Nota |
|---|---|---|
| `--project <nome>` | detectado pelo cwd | |
| `--env <nome>` | — | obrigatório |
| `--db <conexão>` | única conexão da env | obrigatório se houver mais de uma |
| `--limit <n>` | `500` | `0` desliga |
| `--timeout <ms>` | `30000` | |
| `--format json\|table` | `json` | |
| `--explain` | off | roda `EXPLAIN` / `.explain()` |

`--explain` é aplicado pelo **engine**, depois do guard aprovar a query original.
O usuário não escreve `.explain()` na expressão — `explain` não está no whitelist
de operações encadeáveis e seria recusado. No SQL, o engine prefixa `EXPLAIN`; no
Mongo, envolve o cursor já construído.

Query pelo argumento posicional, ou `-` para ler de stdin — pipeline de
`aggregate` com muitos estágios é sofrível de escapar no shell.

### Subcomandos de descoberta

```bash
dbq envs                                    projetos e envs disponíveis
dbq schema --env dev --db mysql             tabelas
dbq schema --env dev --db mysql companies   colunas de uma tabela
dbq schema --env dev --db mongo             coleções (+ shape inferido por amostra)
```

Isto é **central, não acessório**. Um agente que não enxerga o schema chuta nome
de coluna, erra, reinvoca, e queima turno atrás de turno. `schema` é o que
transforma o `dbq` de executor em ferramenta autossuficiente.

## Saída e limites

O inimigo do consumidor não é feiúra, é volume: um `SELECT * FROM companies` sem
cláusula pode despejar centenas de milhares de linhas direto no contexto e
queimar a sessão inteira num comando.

- **JSON em stdout por padrão**, envelope com `rows`, `rowCount`, `truncated`,
  `elapsedMs`. `--format table` para leitura humana.
- **Limite default de 500 injetado**, aplicado mesmo quando a query não pede.
  Quando corta, `truncated: true` acompanha o total real — o consumidor sabe que
  precisa refinar em vez de acreditar que viu tudo. `--limit 0` desliga,
  explicitamente.
- **`maxTimeMS` / timeout de statement de 30s**, ajustável por env.

### O limite é um teto, não uma substituição

Quando a query já declara um limite próprio (`LIMIT 10`, `.limit(10)`), vale o
**menor** dos dois. `--limit 500` sobre uma query com `LIMIT 10` devolve 10
linhas, e `truncated` é `false`. O limite injetado nunca aumenta o resultado,
apenas o teto.

### Como o limite é aplicado

- **Mongo:** `.limit(n + 1)` no cursor. Se voltarem `n + 1` documentos, descarta
  o excedente e marca `truncated: true`.
- **SQL:** truncamento no cliente, consumindo o resultado em stream e parando em
  `n + 1` linhas. Não se envolve subquery (`SELECT * FROM (...) LIMIT n`), que
  quebraria em `SHOW`, `DESCRIBE` e `EXPLAIN` e mudaria o plano de execução.

### Precedência de configuração

Flag da invocação > `defaults` do arquivo da env > default embutido no programa.
Vale para `limit` e `timeoutMs`.

O limite injetado significa que o executor não honra literalmente uma query que
pediu `LIMIT 5000`. É deliberado: o custo dos dois erros é assimétrico — injetar
limite de menos custa uma reinvocação; não injetar custa a sessão.

Cor apenas com `--format table` **e** stdout sendo TTY. JSON jamais recebe ANSI:
byte de escape quebra o parse do consumidor.

## Guard do MongoDB

Gramática aceita, e nada além dela:

```
db.<coleção>.<opLeitura>(<literais>)  [.limit(n)|.sort({..})|.skip(n)|.project({..})]*
```

Algoritmo, via `acorn`:

1. Parse como **Program**, exigindo exatamente uma `ExpressionStatement`. Mata
   `db.x.find({}); db.y.drop()`.
2. Desenrolar a cadeia até a base, que precisa ser `db.<coleção>` com
   **`computed: false`**. Mata `db["compa"+"nies"]["dr"+"op"]()` — não por
   inspecionar strings, mas porque acesso por colchete não é a forma aceita.
3. Toda operação num whitelist. Terminais: `find`, `findOne`, `aggregate`,
   `countDocuments`, `estimatedDocumentCount`, `distinct`. Encadeáveis: `limit`,
   `sort`, `skip`, `project`.
4. Todo argumento precisa ser **literal puro**, verificado recursivamente:
   objeto (chaves não-computadas, sem spread), array (sem spread), string,
   número, booleano, `null`, menos unário sobre número, e regex literal.
   Identificador, chamada de função, template string, concatenação e arrow são
   recusados.
5. **Varredura profunda de chaves** em todos os argumentos, recusando em
   qualquer profundidade:
   - `$out`, `$merge` — **escrevem em coleção**
   - `$where`, `$function`, `$accumulator` — executam JS no servidor

O passo 5 existe porque os quatro primeiros, sozinhos, aprovam
`db.companies.aggregate([{ $out: "backup" }])`, que grava dados. Um pipeline é
sintaticamente um literal puro; a escrita está escondida no *conteúdo* dos dados,
não na forma do código. O whitelist de operações não alcança isso.

Regex literal é **permitida**: `find({ name: /acme/i })` é leitura legítima e não
executa código. Uma regex catastrófica consome CPU do servidor, mas isso é custo,
não escrita, e cai na rede do `maxTimeMS`.

## Guard do SQL

1. Normalizar removendo comentários **antes** de examinar a primeira palavra-
   chave — caso contrário `/*x*/ DROP TABLE y` passa por "não começa com DROP".
2. Exigir statement único (sem `;` encadeando).
3. Primeira palavra-chave em `SELECT`, `WITH`, `SHOW`, `DESCRIBE`, `EXPLAIN`.
4. Recusar `INTO OUTFILE`, `INTO DUMPFILE` (escrevem arquivo) e `FOR UPDATE`
   (não escreve, mas trava linha — efeito colateral suficiente em produção).
5. Reforço no driver: `multipleStatements: false` explícito no mysql2.

## Erros e exit codes

Códigos distintos porque cada um implica uma ação corretiva diferente, e quem lê
é um agente decidindo o próximo passo:

| Código | Significado | Ação implicada |
|---|---|---|
| `0` | sucesso | — |
| `1` | inesperado | — |
| `2` | uso inválido (flag faltando, env inexistente) | corrigir a invocação |
| `3` | recusado pelo guard | reescrever a query |
| `4` | conexão / autenticação | env errada, ou VPN fora |
| `5` | erro do banco (sintaxe, coleção inexistente) | conferir schema |
| `6` | timeout | filtrar mais |

Com `--format json`, o erro sai como JSON em **stderr**:

```json
{ "error": { "code": "READONLY_VIOLATION",
             "message": "operação 'drop' não permitida",
             "hint": "operações de leitura: find, findOne, aggregate, countDocuments, distinct" } }
```

O campo `hint` é deliberado: é o que faz o agente acertar na segunda tentativa em
vez de tentar cinco variações.

**Credencial nunca aparece em mensagem de erro.** Drivers de banco ecoam a
connection string inteira, senha inclusa, ao falhar autenticação. A URI passa por
um scrub antes de qualquer byte alcançar stderr.

## Estratégia de teste

Vitest, com o peso concentrado onde está o risco.

- **Guards — o grosso da suíte, escrito primeiro (TDD).** Funções puras,
  table-driven, zero banco. Dois corpora:
  - queries que **precisam passar**;
  - corpus adversarial que **precisa ser recusado**: `$out` aninhado em pipeline,
    `$merge`, `db["dr"+"op"]()`, `;DROP` encadeado, `DROP` escondido atrás de
    comentário, `INTO OUTFILE`, `FOR UPDATE`, `$where`, `$function`,
    encadeamento de operação fora do whitelist, argumento com chamada de função.

  Cada furo descrito neste documento vira um teste antes de virar código.
- **Resolução de config**: diretório temporário, `~/.config` falso, detecção de
  cwd com repo git sintético, recusa por permissão diferente de `0600`.
- **Envelope e truncamento**: puros, baratos.
- **Engines**: integração opt-in por variável de ambiente, contra Mongo e MySQL
  em docker. Não bloqueiam a suíte principal.

A suíte adversarial dos guards não pode ser pulada nem marcada como skip para
desbloquear build: ela **é** a invariante do projeto.

## Decisões registradas

| Decisão | Alternativa descartada | Razão |
|---|---|---|
| Read-only puro, sem escape | Escrita por flag + env permissiva | Prod a um typo de distância; agente não pode se auto-autorizar |
| Env agrupa N conexões | Um arquivo por conexão | Espelha o ambiente real; `dev-mysql` e `prod-mysql` como strings vizinhas convidam ao erro |
| Auto-detect de projeto pelo cwd, falha alto | `--project` obrigatório; projeto ativo persistido | Ergonomia sem estado global invisível |
| Sintaxe mongosh parseada por AST | `eval` da string; argumentos estruturados | Ergonomia de (a) com a garantia de (b); `eval` transforma a invariante em torcida |
| Limite 500 injetado | Honrar a query como escrita | Custo assimétrico: reinvocação vs. sessão |
| Sem build step (type stripping nativo) | `tsx` + `tsup` | Menos partes móveis; bundler volta se houver publicação |
| Sem Clack, sem ora | CLI interativa | Prompt pendura sem TTY; spinner contamina stdout |
