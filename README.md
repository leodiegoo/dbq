# dbq

Executor **read-only** de queries SQL e MongoDB, configurado por ambiente.

Feito para ser invocado por um agente de IA a partir de qualquer diretório: a
saída é JSON parseável, os erros trazem `hint` acionável, os exit codes
distinguem "reescreva a query" de "conexão errada", e **não existe caminho de
código que escreva no banco**.

## Instalação

```bash
cd ~/Developer/personal/dbq
pnpm install
npm link
```

Requer Node >= 26 — o `bin` aponta direto para o `.ts` e o Node apaga os tipos
em runtime. Não há passo de build.

## Configuração

Crie `~/.config/dbq/<projeto>/<env>.json` com permissão `600`:

```json
{
  "connections": {
    "mysql": { "engine": "mysql",   "uri": "mysql://leitura:senha@host:3306/banco" },
    "mongo": { "engine": "mongodb", "uri": "mongodb://host:27017", "database": "banco" }
  },
  "defaults": { "limit": 500, "timeoutMs": 30000 }
}
```

```bash
chmod 600 ~/.config/dbq/<projeto>/<env>.json
```

O `dbq` recusa executar se a permissão não for `600` — esses arquivos guardam
credencial.

O `<projeto>` é inferido do basename da raiz do repositório git no diretório
atual; `--project` sobrescreve. Se a inferência falhar, o erro lista os projetos
disponíveis em vez de chutar um.

O campo `database` é o banco **default** da conexão. Um nome de banco no path da
URI é sempre ignorado — só o campo e a flag `--database` decidem onde a query
roda, para que não haja dois lugares implícitos discordando.

Um cluster costuma hospedar vários bancos, então `--database` sobrescreve o
default por invocação e evita ter uma conexão nomeada por banco:

```bash
dbq databases --env dev --db mongo              # descobre o que existe
dbq --env dev --db mongo -D outro-banco 'db.rules.find({})'
```

Se nem o campo nem a flag definirem um banco, o erro **lista os bancos
disponíveis** no cluster, para que a reinvocação acerte de primeira.

No MySQL, consulta cross-database já funciona sem flag nenhuma:
`SELECT * FROM outrobanco.tabela` passa pelo guard normalmente, desde que o
usuário tenha permissão.

Aponte as URIs para um usuário **read-only no próprio banco**. O guard protege
de erro humano; o usuário do banco protege de bug no guard.

## Uso

```bash
dbq --env dev "SELECT id, name FROM companies WHERE active = 1"
dbq --env dev --db mongo 'db.companies.find({ active: true }).limit(10)'
cat pipeline.js | dbq --env dev --db mongo -

dbq envs
dbq databases --env dev --db mysql
dbq schema --env dev --db mysql
dbq schema --env dev --db mysql companies
dbq schema --env dev --db mongo companies
```

| Flag | Default | Nota |
|---|---|---|
| `-p, --project <nome>` | inferido do cwd | |
| `-e, --env <nome>` | — | obrigatório |
| `-d, --db <conexão>` | única conexão da env | obrigatório se houver mais de uma |
| `-D, --database <nome>` | campo `database` da conexão | sobrescreve por invocação |
| `-l, --limit <n>` | `500` | teto; `0` desliga |
| `-t, --timeout <ms>` | `30000` | |
| `-f, --format json\|table` | `json` | |
| `-x, --explain` | off | `EXPLAIN` / `.explain()` |

Precedência: flag > `defaults` do arquivo da env > default embutido.

## O que é permitido

**SQL:** `SELECT`, `WITH … SELECT`, `SHOW`, `DESCRIBE`, `EXPLAIN`. Statement
único — comentários são removidos antes da checagem, então `/* x */ DROP` não
passa, e `;` dentro de string não conta como encadeamento. `INTO OUTFILE`, `INTO
DUMPFILE`, `FOR UPDATE` e `LOCK IN SHARE MODE` são recusados.

**Mongo:** exatamente `db.<coleção>.<op>(…)`, com `op` em `find`, `findOne`,
`aggregate`, `countDocuments`, `estimatedDocumentCount`, `distinct`, encadeável
com `limit`, `sort`, `skip`, `project`. A expressão é parseada por AST, nunca
avaliada: argumentos precisam ser literais puros (sem identificador, chamada,
template ou concatenação), e acesso por colchete é recusado — `db["dr"+"op"]()`
morre na forma, não na inspeção da string.

`$out` e `$merge` (gravam em coleção) e `$where`, `$function`, `$accumulator`
(executam JS no servidor) são recusados **em qualquer profundidade** dos
argumentos, inclusive aninhados dentro de um `$facet`. O whitelist de operações
sozinho não alcança isso: a escrita vive no conteúdo dos dados, não na forma do
código.

Não existe flag que destrave escrita.

## Limites

`--limit` é um **teto**, não uma substituição: uma query que já pede menos
continua mandando. Quando corta, a saída traz `"truncated": true` junto do que
foi retornado, para que o consumidor saiba que precisa refinar em vez de
acreditar que viu tudo.

```jsonc
{ "rowCount": 3, "truncated": true, "elapsedMs": 54, "rows": [ /* … */ ] }
```

## Exit codes

| Código | Significado | Ação implicada |
|---|---|---|
| 0 | sucesso | — |
| 1 | inesperado | — |
| 2 | uso inválido | corrigir a invocação |
| 3 | recusado pelo guard | reescrever a query |
| 4 | conexão / autenticação | conferir `--env` e rede |
| 5 | erro do banco | conferir com `dbq schema` |
| 6 | timeout | filtrar mais |

Credencial nunca aparece em mensagem de erro: a URI passa por scrub antes de
qualquer byte alcançar stderr.

## Desenvolvimento

```bash
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
```

A suíte adversarial em `tests/guards/` é a invariante do projeto: nenhum caso
dela pode ser pulado ou marcado como skip para desbloquear build.

Documentos: [design](docs/specs/2026-09-03-dbq-design.md) ·
[plano](docs/plans/2026-09-03-dbq.md).
