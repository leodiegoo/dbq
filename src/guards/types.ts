export const MONGO_READ_OPS = [
  'find',
  'findOne',
  'aggregate',
  'countDocuments',
  'estimatedDocumentCount',
  'distinct',
] as const;

export const MONGO_CHAIN_OPS = ['limit', 'sort', 'skip', 'project'] as const;

/**
 * $out and $merge write to a collection. $where, $function and $accumulator
 * execute JavaScript on the server. The operation whitelist reaches none of
 * them, because the write hides in the content of the arguments rather than in
 * the shape of the code.
 */
export const FORBIDDEN_KEYS = ['$out', '$merge', '$where', '$function', '$accumulator'] as const;

export type MongoReadOp = (typeof MONGO_READ_OPS)[number];
export type MongoChainOp = (typeof MONGO_CHAIN_OPS)[number];

export type MongoModifiers = {
  limit?: number;
  sort?: Record<string, unknown>;
  skip?: number;
  project?: Record<string, unknown>;
};

export type SqlPlan = { kind: 'sql'; statement: string };

export type MongoPlan = {
  kind: 'mongo';
  collection: string;
  operation: MongoReadOp;
  args: unknown[];
  modifiers: MongoModifiers;
};

export type QueryPlan = SqlPlan | MongoPlan;
