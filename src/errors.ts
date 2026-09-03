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

  // ETIMEDOUT appears in both lists, and the timeout check comes first on
  // purpose: a socket that ran out of time is more actionable as "filter
  // harder" than as "check the network".
  if (tags.some((tag) => TIMEOUT_MARKERS.includes(tag))) {
    return new DbqError('TIMEOUT', message, 'narrow the query, or raise --timeout');
  }

  if (tags.some((tag) => CONNECTION_CODES.has(tag))) {
    return new DbqError('CONNECTION_ERROR', message, 'check --env, the connection URI and network access');
  }

  if (tags.some((tag) => tag !== 'Error')) {
    return new DbqError('DATABASE_ERROR', message, 'check the schema with `dbq schema`');
  }

  return new DbqError('UNEXPECTED', message);
};

/**
 * Failures raised while the connection is still opening are always connection
 * errors, never query errors. Without this a `connect ETIMEDOUT` becomes
 * TIMEOUT and the consumer is told to "narrow the query" for a socket that
 * never opened.
 */
export const toConnectionError = (err: unknown): DbqError => {
  const converted = toDbqError(err);
  if (converted.code === 'CONNECTION_ERROR') return converted;
  return new DbqError(
    'CONNECTION_ERROR',
    converted.message,
    'check --env, the connection URI and network access (VPN?)',
  );
};
