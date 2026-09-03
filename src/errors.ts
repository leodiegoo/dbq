const EXIT_BY_CODE = {
  UNEXPECTED: 1,
  USAGE: 2,
  READONLY_VIOLATION: 3,
  CONNECTION_ERROR: 4,
  DATABASE_ERROR: 5,
  TIMEOUT: 6,
} as const;

export type DbqErrorCode = keyof typeof EXIT_BY_CODE;

export class DbqError extends Error {
  readonly code: DbqErrorCode;
  readonly hint: string | undefined;
  readonly exitCode: number;

  constructor(code: DbqErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'DbqError';
    this.code = code;
    this.hint = hint;
    this.exitCode = EXIT_BY_CODE[code];
  }
}

const URI_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s@]*@/gi;

export const scrubUri = (text: string): string => text.replace(URI_CREDENTIALS, '$1:***@');

const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ER_ACCESS_DENIED_ERROR',
  'ER_DBACCESS_DENIED_ERROR',
  'ER_NOT_SUPPORTED_AUTH_MODE',
  'MongoServerSelectionError',
  'MongoNetworkError',
]);

const TIMEOUT_MARKERS = ['MaxTimeMSExpired', 'ETIMEDOUT', 'PROTOCOL_SEQUENCE_TIMEOUT'];

const readTag = (err: object, key: string): string =>
  key in err ? String((err as Record<string, unknown>)[key] ?? '') : '';

export const toDbqError = (err: unknown): DbqError => {
  if (err instanceof DbqError) return err;

  if (!(err instanceof Error)) {
    return new DbqError('UNEXPECTED', scrubUri(String(err)));
  }

  const tags = [readTag(err, 'code'), readTag(err, 'codeName'), err.name].filter(Boolean);
  const message = scrubUri(err.message);

  // ETIMEDOUT aparece nas duas listas e a checagem de timeout vem primeiro de
  // proposito: um socket que estourou o tempo e mais acionavel como "filtre
  // mais" do que como "confira a rede".
  if (tags.some((tag) => TIMEOUT_MARKERS.includes(tag))) {
    return new DbqError('TIMEOUT', message, 'reduza o escopo da query ou aumente --timeout');
  }

  if (tags.some((tag) => CONNECTION_CODES.has(tag))) {
    return new DbqError('CONNECTION_ERROR', message, 'confira --env, a URI da conexao e o acesso a rede');
  }

  if (tags.some((tag) => tag !== 'Error')) {
    return new DbqError('DATABASE_ERROR', message, 'confira o schema com `dbq schema`');
  }

  return new DbqError('UNEXPECTED', message);
};

/**
 * Erros levantados enquanto a conexao ainda esta sendo aberta sao sempre de
 * conexao, nunca de query. Sem isso um `connect ETIMEDOUT` vira TIMEOUT e o
 * consumidor recebe "reduza o escopo da query" para um socket que nem abriu.
 */
export const toConnectionError = (err: unknown): DbqError => {
  const converted = toDbqError(err);
  if (converted.code === 'CONNECTION_ERROR') return converted;
  return new DbqError(
    'CONNECTION_ERROR',
    converted.message,
    'confira --env, a URI da conexao e o acesso a rede (VPN?)',
  );
};
