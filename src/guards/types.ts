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
 * $out e $merge gravam em colecao. $where, $function e $accumulator executam
 * JavaScript no servidor. Nenhum deles e alcancado pelo whitelist de operacoes,
 * porque a escrita vive no conteudo dos argumentos, nao na forma do codigo.
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
