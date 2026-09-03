import { parse } from 'acorn';
import type { Node } from 'acorn';
import { DbqError } from '../errors.ts';
import {
  FORBIDDEN_KEYS,
  MONGO_CHAIN_OPS,
  MONGO_READ_OPS,
  type MongoModifiers,
  type MongoPlan,
  type MongoReadOp,
} from './types.ts';

const HINT = `operacoes de leitura: ${MONGO_READ_OPS.join(', ')}; encadeaveis: ${MONGO_CHAIN_OPS.join(', ')}`;

const refuse = (reason: string): never => {
  throw new DbqError('READONLY_VIOLATION', reason, HINT);
};

type AnyNode = Node & Record<string, unknown>;

const isNode = (value: unknown): value is AnyNode =>
  typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';

/**
 * Converte um no de AST em valor, aceitando exclusivamente literais puros.
 * Identificador, chamada, template, concatenacao, spread e chave computada sao
 * recusados aqui — e por isso que `db.c.find({ a: fn() })` morre antes de
 * qualquer conexao ser aberta.
 */
const toLiteral = (node: AnyNode): unknown => {
  switch (node.type) {
    case 'Literal': {
      if ('regex' in node && node.regex) {
        const { pattern, flags } = node.regex as { pattern: string; flags: string };
        return new RegExp(pattern, flags);
      }
      return node.value;
    }

    case 'UnaryExpression': {
      const argument = node.argument as AnyNode;
      if ((node.operator === '-' || node.operator === '+') && argument.type === 'Literal') {
        const value = toLiteral(argument);
        if (typeof value !== 'number') refuse('operador unario so e permitido sobre numero');
        return node.operator === '-' ? -(value as number) : value;
      }
      return refuse(`expressao '${String(node.operator)}' nao e um literal`);
    }

    case 'ArrayExpression': {
      const elements = node.elements as Array<AnyNode | null>;
      return elements.map((element) => {
        if (element === null) return refuse('elemento vazio em array nao e permitido');
        if (element.type === 'SpreadElement') return refuse('spread nao e permitido');
        return toLiteral(element);
      });
    }

    case 'ObjectExpression': {
      const result: Record<string, unknown> = {};
      for (const property of node.properties as AnyNode[]) {
        if (property.type !== 'Property') refuse('spread nao e permitido');
        if (property.computed === true) refuse('chave computada nao e permitida');

        const key = property.key as AnyNode;
        const name =
          key.type === 'Identifier'
            ? String(key.name)
            : key.type === 'Literal'
              ? String(key.value)
              : refuse('chave precisa ser identificador ou string');

        if ((FORBIDDEN_KEYS as readonly string[]).includes(name as string)) {
          refuse(`operador '${String(name)}' nao e permitido: grava dados ou executa javascript no servidor`);
        }

        result[name as string] = toLiteral(property.value as AnyNode);
      }
      return result;
    }

    default:
      return refuse(`'${String(node.type)}' nao e um literal puro`);
  }
};

type Call = { name: string; args: unknown[] };

const readModifier = (modifiers: MongoModifiers, call: Call): void => {
  const [value] = call.args;

  if (call.name === 'limit' || call.name === 'skip') {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      refuse(`'${call.name}' exige um inteiro nao negativo`);
    }
    modifiers[call.name] = value as number;
    return;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    refuse(`'${call.name}' exige um objeto`);
  }
  modifiers[call.name as 'sort' | 'project'] = value as Record<string, unknown>;
};

export const guardMongo = (raw: string): MongoPlan => {
  const source = raw.trim();
  if (source.length === 0) refuse('query vazia');

  let program;
  try {
    program = parse(source, { ecmaVersion: 2024, sourceType: 'script' });
  } catch {
    return refuse('expressao invalida: use a forma db.<colecao>.<operacao>(...)');
  }

  const body = program.body as AnyNode[];
  if (body.length !== 1) refuse('apenas um statement e permitido');

  const [statement] = body;
  if (!statement || statement.type !== 'ExpressionStatement') {
    refuse('a query precisa ser uma unica expressao');
  }

  // Desenrola a cadeia de chamadas da ponta para a base.
  const calls: Call[] = [];
  let cursor = (statement as AnyNode).expression as AnyNode;

  while (cursor.type === 'CallExpression') {
    const callee = cursor.callee as AnyNode;
    if (callee.type !== 'MemberExpression') refuse('forma invalida: esperado db.<colecao>.<operacao>(...)');
    if (callee.computed === true) refuse('acesso por colchete nao e permitido');

    const property = callee.property as AnyNode;
    if (property.type !== 'Identifier') refuse('nome de operacao precisa ser um identificador');

    const args = (cursor.arguments as AnyNode[]).map((argument) => {
      if (!isNode(argument) || argument.type === 'SpreadElement') refuse('spread nao e permitido');
      return toLiteral(argument);
    });

    calls.unshift({ name: String(property.name), args });
    cursor = callee.object as AnyNode;
  }

  if (calls.length === 0) refuse('forma invalida: esperado db.<colecao>.<operacao>(...)');

  // A base precisa ser exatamente `db.<colecao>`, sem colchetes.
  if (cursor.type !== 'MemberExpression' || cursor.computed === true) {
    refuse('a base precisa ser db.<colecao>');
  }

  const base = cursor.object as AnyNode;
  const collectionNode = cursor.property as AnyNode;
  if (base.type !== 'Identifier' || String(base.name) !== 'db') refuse("a base precisa comecar em 'db'");
  if (collectionNode.type !== 'Identifier') refuse('nome de colecao precisa ser um identificador');

  const [operationCall, ...chain] = calls;
  if (!operationCall) refuse('nenhuma operacao informada');

  if (!(MONGO_READ_OPS as readonly string[]).includes((operationCall as Call).name)) {
    refuse(`operacao '${(operationCall as Call).name}' nao e permitida`);
  }

  const modifiers: MongoModifiers = {};
  for (const call of chain) {
    if (!(MONGO_CHAIN_OPS as readonly string[]).includes(call.name)) {
      refuse(`operacao encadeada '${call.name}' nao e permitida`);
    }
    readModifier(modifiers, call);
  }

  return {
    kind: 'mongo',
    collection: String(collectionNode.name),
    operation: (operationCall as Call).name as MongoReadOp,
    args: (operationCall as Call).args,
    modifiers,
  };
};
