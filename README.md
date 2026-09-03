# dbq

Executor **read-only** de queries SQL e MongoDB, configurado por ambiente e invocável de qualquer diretório.

Feito para ser usado por um agente de IA: a saída é JSON parseável, os erros trazem uma dica acionável, os exit codes distinguem "reescreva a query" de "conexão errada" — e **não existe caminho de código que escreva no banco**.

```bash
dbq --env dev "SELECT id, name FROM companies WHERE active = 1"
dbq --env dev --db mongo 'db.companies.find({ active: true }).limit(10)'
```

---

## Índice

- [Por que existe](#por-que-existe)
- [Requisitos](#requisitos)
- [Instalação](#instalação)
- [Configuração](#configuração)
- [Uso](#uso)
- [Descoberta](#descoberta-envs-databases-schema)
- [O que é permitido](#o-que-é-permitido)
- [Limites e truncamento](#limites-e-truncamento)
- [Saída](#saída)
- [Exit codes](#exit-codes)
- [Como funciona por dentro](#como-funciona-por-dentro)
- [Receitas](#receitas)
- [Solução de problemas](#solução-de-problemas)
- [Desenvolvimento](#desenvolvimento)

---

## Por que existe

Dar a um agente de IA acesso direto a um banco tem dois problemas, e eles são independentes.

**O primeiro é destruição.** Um agente com contexto errado roda `DELETE` em produção sem má intenção nenhuma. A resposta usual — "confie no prompt" — não é resposta. O `dbq` recusa escrita **estruturalmente**: a query é validada antes de qualquer conexão ser aberta, e não existe flag, variável de ambiente ou campo de config que destrave isso.

```bash
$ dbq --env production 'db.plans.drop()'
{ "error": { "code": "READONLY_VIOLATION", "message": "operacao 'drop' nao e permitida", … } }
$ echo $?
3
```

Nenhum pacote de rede saiu da máquina nesse comando.

**O segundo é volume.** Um `SELECT * FROM companies` sem cláusula devolve centenas de milhares de linhas direto no contexto e queima a sessão inteira num comando. O `dbq` injeta um teto de linhas mesmo quando a query não pede, e avisa quando cortou.

---

## Requisitos

- **Node >= 26.** O binário aponta direto para um `.ts` e o Node apaga os tipos em runtime — sem passo de build, sem `dist/`.
- MySQL e/ou MongoDB alcançáveis pela rede (VPN, se for o caso).

---

## Instalação

```bash
git clone https://github.com/leodiegoo/dbq.git
cd dbq
pnpm install
npm link
```

`npm link` coloca `dbq` no PATH. Confira:

```bash
dbq --version   # 0.1.0
dbq --help
```

> `npm link` é o caminho de desenvolvimento — edições no fonte valem imediatamente, sem reinstalar.

---

## Configuração

### Onde os arquivos ficam

```
~/.config/dbq/<projeto>/<env>.json
```

Respeita `$XDG_CONFIG_HOME` quando definido. O `dbq` é dono do próprio diretório em vez de espalhar nomes de projeto direto em `~/.config/` — território compartilhado com `nvim`, `gh`, `fish` e outros.

Exemplo de uma máquina com dois projetos:

```
~/.config/dbq/
├── meu-projeto/
│   ├── dev.json
│   ├── staging.json
│   └── production.json
└── outro-projeto/
    └── local.json
```

### Criando o primeiro arquivo

```bash
mkdir -p ~/.config/dbq/meu-projeto

cat > ~/.config/dbq/meu-projeto/dev.json <<'EOF'
{
  "connections": {
    "mysql": {
      "engine": "mysql",
      "uri": "mysql://leitura:senha@10.0.0.1:3306/meubanco"
    },
    "mongo": {
      "engine": "mongodb",
      "uri": "mongodb://leitura:senha@10.0.0.2:27017",
      "database": "meubanco"
    }
  },
  "defaults": { "limit": 500, "timeoutMs": 30000 }
}
EOF

chmod 600 ~/.config/dbq/meu-projeto/dev.json
```

**O `chmod 600` não é opcional:** o `dbq` recusa executar se a permissão for outra. Esses arquivos guardam credencial.

```
USAGE: /Users/…/dev.json esta com permissao 644; esperado 600
dica: rode: chmod 600 /Users/…/dev.json
```

### Campos

| Campo | Obrigatório | O quê |
|---|---|---|
| `connections` | sim | mapa de conexões nomeadas |
| `connections.<nome>.engine` | sim | `"mysql"` ou `"mongodb"` |
| `connections.<nome>.uri` | sim | URI de conexão completa |
| `connections.<nome>.database` | não | banco **default** dessa conexão |
| `defaults.limit` | não | teto de linhas (embutido: `500`) |
| `defaults.timeoutMs` | não | timeout do statement (embutido: `30000`) |

**Precedência:** flag da invocação > `defaults` do arquivo > default embutido.

O nome de banco no path da URI é **sempre ignorado**. Só o campo `database` e a flag `-D` decidem onde a query roda — assim não há dois lugares implícitos discordando.

### Um arquivo agrupa N conexões

Um ambiente real não é um banco só: `dev` costuma ser MySQL **e** MongoDB simultaneamente. Por isso a unidade é o ambiente, com conexões nomeadas dentro.

`--db` é opcional quando a env declara uma única conexão, e obrigatório quando há mais de uma:

```
USAGE: a env 'dev' tem varias conexoes: mysql, mongo
dica: passe --db <conexao>
```

O desenho é deliberado: trocar de ambiente é **uma** ação, e `--env` fica sendo o eixo explícito que separa dev de produção. Com um arquivo por conexão, `dev-mysql` e `prod-mysql` seriam strings vizinhas num mesmo argumento — exatamente o erro que não se quer facilitar.

### Senha com caracteres especiais

A senha vai na URI, então precisa ser percent-encoded. Caracteres que **quebram** se não forem escapados: `#` `@` `/` `:` `?` `&` `%`.

```bash
node -e 'console.log(encodeURIComponent(process.argv[1]))' 'minha#senha@estranha'
# minha%23senha%40estranha
```

### Como o projeto é descoberto

O `dbq` sobe do diretório atual até a raiz do repositório git e usa o basename. Estando em qualquer lugar dentro de `~/code/meu-projeto`, `--project` é desnecessário.

Se não houver correspondência em `~/.config/dbq/`, ele **falha** listando as alternativas — nunca chuta, nunca cai num default:

```
USAGE: nao foi possivel inferir o projeto a partir de '/tmp'. Disponiveis: meu-projeto, outro-projeto
dica: passe --project <nome>
```

Não existe "projeto ativo" persistido em lugar nenhum. Estado global invisível é como se acerta o comando e se erra o banco.

### Recomendação de segurança

Aponte as URIs para um **usuário read-only no próprio banco**.

```sql
CREATE USER 'dbq_leitura'@'%' IDENTIFIED BY '…';
GRANT SELECT, SHOW VIEW ON meubanco.* TO 'dbq_leitura'@'%';
```

```js
db.createUser({ user: "dbq_leitura", pwd: "…", roles: [{ role: "read", db: "meubanco" }] })
```

O guard te protege de erro humano; o usuário do banco te protege de um bug no guard. São camadas diferentes e você quer as duas.

---

## Uso

```bash
dbq [opções] <query>
```

| Flag | Default | O quê |
|---|---|---|
| `-p, --project <nome>` | inferido do cwd | projeto em `~/.config/dbq` |
| `-e, --env <nome>` | — | **obrigatório** |
| `-d, --db <conexão>` | única da env | obrigatório se houver mais de uma |
| `-D, --database <nome>` | campo `database` | banco a consultar, por invocação |
| `-l, --limit <n>` | `500` | teto de linhas; `0` desliga |
| `-t, --timeout <ms>` | `30000` | timeout do statement |
| `-f, --format <json\|table>` | `json` | formato da saída |
| `-x, --explain` | off | roda `EXPLAIN` / `.explain()` |

### SQL

```bash
dbq -e dev -d mysql "SELECT id, name FROM companies WHERE active = 1"
dbq -e dev -d mysql "SHOW TABLES"
dbq -e dev -d mysql -x "SELECT * FROM orders WHERE user_id = 42"
```

### MongoDB

A expressão usa a sintaxe do `mongosh`, com `db` referindo o banco resolvido:

```bash
dbq -e dev -d mongo 'db.companies.find({ active: true })'
dbq -e dev -d mongo 'db.companies.find({}, { name: 1 }).sort({ name: 1 }).limit(20)'
dbq -e dev -d mongo 'db.orders.aggregate([{ $match: { paid: true } }, { $group: { _id: "$userId", n: { $sum: 1 } } }])'
```

### Query pelo stdin

Pipeline longo é sofrível de escapar no shell. Use `-`:

```bash
cat pipeline.js | dbq -e dev -d mongo -
dbq -e dev -d mysql - < consulta.sql
```

### Trocando de banco sem trocar de conexão

Um cluster hospeda vários bancos. `-D` sobrescreve o default por invocação:

```bash
dbq databases -e dev -d mongo                        # descobre o que existe
dbq -e dev -d mongo -D outro-banco 'db.users.find({})'
dbq -e dev -d mysql -D information_schema "SELECT DATABASE()"
```

No MySQL, cross-database também funciona sem flag nenhuma: `SELECT * FROM outrobanco.tabela` passa normalmente, desde que o usuário tenha permissão.

---

## Descoberta: `envs`, `databases`, `schema`

Um agente que não enxerga o schema chuta nome de coluna, erra e queima turno atrás de turno. A trilha completa:

```bash
dbq envs                                  # projetos e ambientes configurados
dbq databases -e dev -d mongo             # bancos daquela conexão
dbq schema -e dev -d mysql                # tabelas
dbq schema -e dev -d mysql companies      # colunas, tipos, chaves
dbq schema -e dev -d mongo                # coleções
dbq schema -e dev -d mongo companies      # campos, tipos e presença
```

O `schema` do Mongo amostra 100 documentos e reporta **presença** por campo — sinal que evita escrever query sobre campo opcional:

```
field                 types    presence
--------------------  -------  --------
_id                   string   100%
lastLoginAt           boolean  86%
deletedAt  boolean  14%
name                  string   100%
```

> **Subcomandos vêm antes das flags.** `dbq schema -e dev`, não `dbq -e dev schema`. A ordem trocada é recusada com a invocação corrigida na dica.

---

## O que é permitido

### SQL

**Aceito:** `SELECT`, `WITH … SELECT`, `SHOW`, `DESCRIBE`, `EXPLAIN`.

**Recusado:** todo o resto, mais `INTO OUTFILE` e `INTO DUMPFILE` (escrevem arquivo no servidor), `FOR UPDATE` e `LOCK IN SHARE MODE` (travam linhas).

Comentários são removidos **antes** da checagem da primeira palavra-chave, e literais de string são neutralizados:

```sql
/* inofensivo */ DROP TABLE companies   -- recusado
SELECT 1; DROP TABLE companies          -- recusado (statement único)
SELECT * FROM t WHERE name = 'a;b'      -- aceito (o ; está numa string)
```

### MongoDB

**Forma aceita:** exatamente `db.<coleção>.<operação>(…)`, opcionalmente encadeada.

| | |
|---|---|
| Operações | `find` `findOne` `aggregate` `countDocuments` `estimatedDocumentCount` `distinct` |
| Encadeáveis | `limit` `sort` `skip` `project` |
| Argumentos | apenas literais puros: objeto, array, string, número, booleano, `null`, regex |

A expressão é **parseada por AST, nunca avaliada**. Isso não é detalhe de implementação — é a decisão que sustenta a garantia:

```js
db.companies.drop()              // recusado: operação fora do whitelist
db["compa" + "nies"].drop()      // recusado: acesso por colchete não é a forma aceita
db.c.find({ a: fn() })           // recusado: argumento não é literal puro
db.c.find({}).toArray()          // recusado: encadeamento fora do whitelist
db.c.find({}); db.d.drop()       // recusado: mais de um statement
```

`db["compa" + "nies"]` não morre porque alguém inspecionou a string procurando `drop` — morre porque concatenação simplesmente não faz parte da gramática aceita.

**Operadores proibidos em qualquer profundidade** dos argumentos:

| Operador | Por quê |
|---|---|
| `$out`, `$merge` | **gravam em coleção** |
| `$where`, `$function`, `$accumulator` | executam JavaScript no servidor |

```js
db.c.aggregate([{ $out: "backup" }])                    // recusado
db.c.aggregate([{ $facet: { a: [{ $out: "x" }] } }])    // recusado, aninhado
db.c.find({ $and: [{ $where: "true" }] })               // recusado, aninhado
```

Isso existe porque o whitelist de operações **não alcança** esses casos: um pipeline com `$out` é sintaticamente um literal puro. A escrita vive no conteúdo dos dados, não na forma do código.

> Não existe flag que destrave escrita. Se você precisa escrever, o `dbq` não é a ferramenta.

---

## Limites e truncamento

`--limit` é um **teto**, não uma substituição — uma query que já pede menos continua mandando:

| Query | `--limit` | Resultado |
|---|---|---|
| `find({})` sobre 134 docs | 500 | 134 linhas, `truncated: false` |
| `find({})` sobre 134 docs | 3 | 3 linhas, `truncated: true` |
| `find({}).limit(2)` | 3 | 2 linhas, `truncated: false` |

`--limit 0` desliga o teto, explicitamente.

Quando corta, a saída avisa — o consumidor sabe que precisa refinar em vez de acreditar que viu tudo:

```json
{ "rowCount": 3, "truncated": true, "elapsedMs": 54, "rows": [ … ] }
```

O teto injetado significa que o `dbq` não honra literalmente um `LIMIT 5000`. É deliberado: o custo dos dois erros é assimétrico — injetar limite de menos custa uma reinvocação, não injetar custa a sessão.

---

## Saída

**JSON** (default), num envelope com metadados:

```json
{
  "project": "meu-projeto",
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

`Date`, `RegExp`, `ObjectId`, `BigInt` e `Buffer` são serializados de forma legível — sem isso o consumidor receberia `{}` no lugar de um id, que é pior que um erro porque parece um dado válido.

**Tabela**, para olho humano:

```bash
dbq -e dev -d mysql -f table "SELECT id, name FROM appdb"
```

```
id   name
---  --------------
530  Acme
470  Globex

2 linha(s) em 49ms — meu-projeto/dev/mysql
```

Cor só aparece com `--format table` **e** stdout sendo TTY. JSON jamais recebe ANSI: um byte de escape quebraria o `JSON.parse` do consumidor.

---

## Exit codes

Cada código implica uma ação corretiva diferente — é o que permite um agente decidir o próximo passo sem interpretar texto:

| Código | Significado | O que fazer |
|---|---|---|
| `0` | sucesso | — |
| `1` | inesperado | — |
| `2` | uso inválido | corrigir a invocação |
| `3` | recusado pelo guard | reescrever a query |
| `4` | conexão / autenticação | conferir `--env`, credenciais, VPN |
| `5` | erro do banco | conferir com `dbq schema` |
| `6` | timeout | filtrar mais, ou aumentar `--timeout` |

Erro sai em **stderr**, no mesmo formato da saída:

```json
{
  "error": {
    "code": "READONLY_VIOLATION",
    "message": "operador '$out' nao e permitido: grava dados ou executa javascript no servidor",
    "hint": "operacoes de leitura: find, findOne, aggregate, countDocuments, estimatedDocumentCount, distinct; …"
  }
}
```

O campo `hint` é deliberado: é o que faz acertar na segunda tentativa em vez de tentar cinco variações.

**Credencial nunca aparece em mensagem de erro.** Drivers adoram ecoar a connection string inteira, senha inclusa, ao falhar autenticação — a URI passa por scrub antes de qualquer byte alcançar stderr.

---

## Como funciona por dentro

```
argv → resolveProject → loadEnv → guard → engine → envelope → stdout
```

```
src/
  cli.ts            argv, orquestração, tradução de erro → exit code
  config/           resolve projeto pelo cwd; lê e valida a env
  guards/           valida a query          (funções puras, zero I/O)
  engines/          executa o que foi aprovado
  schema/           descoberta de tabelas, coleções e bancos
  output/           truncamento e formatação
  errors.ts         DbqError, exit codes, scrub de credenciais
```

**A fronteira que sustenta o projeto: guards nunca abrem conexão, engines nunca veem input cru.**

O engine recebe uma estrutura já validada — uma coleção, uma operação vinda de um whitelist, argumentos já provados literais. Não existe caminho de código no qual uma string do usuário alcance o driver sem atravessar o guard.

Duas consequências práticas:

1. **O read-only é estrutural, não otimista.** Uma query destrutiva contra produção morre no parser, antes de a rede ser tocada.
2. **Os guards são funções puras**, então a suíte que protege a garantia roda sem banco nenhum — e é por isso que ela pode ser exaustiva.

O detalhamento de cada decisão, com as alternativas descartadas e o porquê, está em [docs/specs/2026-09-03-dbq-design.md](docs/specs/2026-09-03-dbq-design.md).

---

## Receitas

**Contar antes de listar**, para saber se vale pedir os dados:

```bash
dbq -e dev -d mongo 'db.orders.countDocuments({ status: "pending" })'
```

**Explorar uma tabela desconhecida:**

```bash
dbq schema -e dev -d mysql                        # que tabelas existem
dbq schema -e dev -d mysql orders                 # que colunas tem
dbq -e dev -d mysql -l 5 "SELECT * FROM orders"   # como os dados se parecem
```

**Comparar ambientes** (fish):

```fish
for env in dev staging production
  dbq -e $env -d mysql "SELECT COUNT(*) AS n FROM companies"
end
```

**Query longa em arquivo:**

```bash
dbq -e dev -d mysql - < relatorio.sql
```

**Extrair um campo com `jq`:**

```bash
dbq -e dev -d mongo 'db.plans.find({}, { name: 1 })' | jq -r '.rows[].name'
```

**Checar se uma query é aceita, sem rodar:** invoque contra uma env qualquer. Se sair com `3`, o guard recusou — e nenhuma conexão foi aberta.

---

## Solução de problemas

| Sintoma | Causa provável |
|---|---|
| `esta com permissao 644; esperado 600` | rode o `chmod 600` no arquivo da env |
| `nao foi possivel inferir o projeto` | você está fora do repo; passe `--project` |
| `a env 'dev' tem varias conexoes` | passe `--db <conexao>` |
| `nenhum banco definido para esta conexao` | passe `-D <nome>`, ou declare `database` no arquivo |
| `'schema' e um subcomando, nao uma query` | subcomando vem antes das flags |
| exit `4` com `ETIMEDOUT` | VPN desconectada, ou host inalcançável |
| exit `6` | query pesada demais; filtre mais ou aumente `--timeout` |
| resultado menor que o esperado | veja `truncated` na saída; suba o `--limit` |

Erros de resolução **listam as alternativas** no próprio texto — projeto não inferido lista os projetos, env inexistente lista as envs, banco indefinido lista os bancos do cluster. A reinvocação corrigida sai direto do erro.

---

## Desenvolvimento

```bash
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
```

A suíte adversarial em `tests/guards/` é a invariante do projeto: nenhum caso dela pode ser pulado ou marcado como skip para desbloquear build.

Antes de mexer no código, leia o **[AGENTS.md](AGENTS.md)** — arquitetura, a fronteira guard/engine, restrições do type stripping e onde adicionar cada tipo de código.

Documentos: [AGENTS.md](AGENTS.md) · [design](docs/specs/2026-09-03-dbq-design.md) · [plano de implementação](docs/plans/2026-09-03-dbq.md)

---

## Escopo

**Dentro:** MySQL, MongoDB, queries de leitura, descoberta de schema, config por projeto e ambiente.

**Fora:** PostgreSQL, OpenSearch, Redis, escrita de qualquer natureza, prompts interativos.

Expansão de `${VAR}` nas URIs — para tirar senha de produção do texto puro — está anotada como candidata a v2.
