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

const HINT = `read operations: ${MONGO_READ_OPS.join(', ')}; chainable: ${MONGO_CHAIN_OPS.join(', ')}`;

const refuse = (reason: string): never => {
  throw new DbqError('READONLY_VIOLATION', reason, HINT);
};

type AnyNode = Node & Record<string, unknown>;

const isNode = (value: unknown): value is AnyNode =>
  typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';

/**
 * Turns an AST node into a value, accepting pure literals and nothing else.
 * Identifiers, calls, templates, concatenation, spread and computed keys are
 * refused here — which is why `db.c.find({ a: fn() })` dies before any
 * connection is opened.
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
        if (typeof value !== 'number') refuse('a unary operator is only allowed on a number');
        return node.operator === '-' ? -(value as number) : value;
      }
      return refuse(`expression '${String(node.operator)}' is not a literal`);
    }

    case 'ArrayExpression': {
      const elements = node.elements as Array<AnyNode | null>;
      return elements.map((element) => {
        if (element === null) return refuse('a hole in an array is not allowed');
        if (element.type === 'SpreadElement') return refuse('spread is not allowed');
        return toLiteral(element);
      });
    }

    case 'ObjectExpression': {
      const result: Record<string, unknown> = {};
      for (const property of node.properties as AnyNode[]) {
        if (property.type !== 'Property') refuse('spread is not allowed');
        if (property.computed === true) refuse('a computed key is not allowed');

        const key = property.key as AnyNode;
        const name =
          key.type === 'Identifier'
            ? String(key.name)
            : key.type === 'Literal'
              ? String(key.value)
              : refuse('a key must be an identifier or a string');

        if ((FORBIDDEN_KEYS as readonly string[]).includes(name as string)) {
          refuse(`operator '${String(name)}' is not allowed: it writes data or runs JavaScript on the server`);
        }

        result[name as string] = toLiteral(property.value as AnyNode);
      }
      return result;
    }

    default:
      return refuse(`'${String(node.type)}' is not a pure literal`);
  }
};

type Call = { name: string; args: unknown[] };

const readModifier = (modifiers: MongoModifiers, call: Call): void => {
  const [value] = call.args;

  if (call.name === 'limit' || call.name === 'skip') {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      refuse(`'${call.name}' requires a non-negative integer`);
    }
    modifiers[call.name] = value as number;
    return;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    refuse(`'${call.name}' requires an object`);
  }
  modifiers[call.name as 'sort' | 'project'] = value as Record<string, unknown>;
};

export const guardMongo = (raw: string): MongoPlan => {
  const source = raw.trim();
  if (source.length === 0) refuse('empty query');

  let program;
  try {
    program = parse(source, { ecmaVersion: 2024, sourceType: 'script' });
  } catch {
    return refuse('invalid expression: use the form db.<collection>.<operation>(...)');
  }

  const body = program.body as AnyNode[];
  if (body.length !== 1) refuse('only one statement is allowed');

  const [statement] = body;
  if (!statement || statement.type !== 'ExpressionStatement') {
    refuse('the query must be a single expression');
  }

  // Unwind the call chain from the tail back to the base.
  const calls: Call[] = [];
  let cursor = (statement as AnyNode).expression as AnyNode;

  while (cursor.type === 'CallExpression') {
    const callee = cursor.callee as AnyNode;
    if (callee.type !== 'MemberExpression') refuse('invalid shape: expected db.<collection>.<operation>(...)');
    if (callee.computed === true) refuse('bracket access is not allowed');

    const property = callee.property as AnyNode;
    if (property.type !== 'Identifier') refuse('an operation name must be an identifier');

    const args = (cursor.arguments as AnyNode[]).map((argument) => {
      if (!isNode(argument) || argument.type === 'SpreadElement') refuse('spread is not allowed');
      return toLiteral(argument);
    });

    calls.unshift({ name: String(property.name), args });
    cursor = callee.object as AnyNode;
  }

  if (calls.length === 0) refuse('invalid shape: expected db.<collection>.<operation>(...)');

  // The base must be exactly `db.<collection>`, with no brackets.
  if (cursor.type !== 'MemberExpression' || cursor.computed === true) {
    refuse('the base must be db.<collection>');
  }

  const base = cursor.object as AnyNode;
  const collectionNode = cursor.property as AnyNode;
  if (base.type !== 'Identifier' || String(base.name) !== 'db') refuse("the base must start at 'db'");
  if (collectionNode.type !== 'Identifier') refuse('a collection name must be an identifier');

  const [operationCall, ...chain] = calls;
  if (!operationCall) refuse('no operation given');

  if (!(MONGO_READ_OPS as readonly string[]).includes((operationCall as Call).name)) {
    refuse(`operation '${(operationCall as Call).name}' is not allowed`);
  }

  const modifiers: MongoModifiers = {};
  for (const call of chain) {
    if (!(MONGO_CHAIN_OPS as readonly string[]).includes(call.name)) {
      refuse(`chained operation '${call.name}' is not allowed`);
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
