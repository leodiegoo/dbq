import pc from 'picocolors';
import { encode } from '@toon-format/toon';
import type { DbqError } from '../errors.ts';

export type Envelope = {
  project: string;
  env: string;
  db: string;
  engine: 'mysql' | 'postgres' | 'mongodb' | 'redis';
  rowCount: number;
  truncated: boolean;
  cursor?: string;
  elapsedMs: number;
  rows: unknown[];
};

export const applyLimit = <T>(rows: T[], limit: number): { rows: T[]; truncated: boolean } => {
  if (limit <= 0 || rows.length <= limit) return { rows, truncated: false };
  return { rows: rows.slice(0, limit), truncated: true };
};

/**
 * Drivers return values that JSON.stringify represents poorly: ObjectId, Date,
 * RegExp, Buffer, BigInt. Without this the consumer gets `{}` where an id
 * should be — worse than an error, because it looks like valid data.
 */
type JsonReplacerValue = object | string | number | boolean | null | undefined;

const replacer = function (this: unknown, key: string, value: unknown): JsonReplacerValue {
  // JSON.stringify calls toJSON before the replacer, so a Date arrives as a
  // string: the raw value has to come from the parent object.
  const original = (this as Record<string, unknown>)[key];
  if (original instanceof Date) return original.toISOString();
  if (original instanceof RegExp) return original.toString();
  if (typeof original === 'bigint') return original.toString();
  if (original instanceof Uint8Array) return Buffer.from(original).toString('base64');
  if (value === null || value === undefined || typeof value === 'object') return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
};

export const formatJsonValue = (value: unknown): string => JSON.stringify(value, replacer, 2);

export const formatJson = (envelope: Envelope): string => formatJsonValue(envelope);

export const formatToonValue = (value: unknown): string =>
  encode(JSON.parse(JSON.stringify(value, replacer)) as unknown);

export const formatToon = (envelope: Envelope): string => formatToonValue(envelope);

export const truncateContent = (
  value: unknown,
  full: boolean,
  maxCharacters = 1_000,
): { value: unknown; truncated: boolean } => {
  const normalized = JSON.parse(JSON.stringify(value, replacer)) as unknown;
  if (full) return { value: normalized, truncated: false };

  let truncated = false;
  const visit = (entry: unknown): unknown => {
    if (typeof entry === 'string') {
      const characters = Array.from(entry);
      if (characters.length > maxCharacters) {
        truncated = true;
        return `${characters.slice(0, maxCharacters).join('')}… (truncated; ${characters.length} characters total; use --full)`;
      }
    }
    if (Array.isArray(entry)) return entry.map(visit);
    if (typeof entry === 'object' && entry !== null) {
      return Object.fromEntries(Object.entries(entry).map(([key, child]) => [key, visit(child)]));
    }
    return entry;
  };

  return { value: visit(normalized), truncated };
};

const cell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value, replacer);
  return String(value);
};

export const formatTable = (envelope: Envelope, color: boolean): string => {
  const paint = (text: string): string => (color ? pc.bold(text) : text);
  const lines: string[] = [];

  if (envelope.rows.length === 0) {
    lines.push('0 rows');
  } else {
    const columns: string[] = [];
    for (const row of envelope.rows) {
      if (typeof row !== 'object' || row === null) continue;
      for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
    }

    const header = columns.length > 0 ? columns : ['value'];
    const body = envelope.rows.map((row) =>
      columns.length > 0 ? header.map((key) => cell((row as Record<string, unknown>)[key])) : [cell(row)],
    );

    const widths = header.map((key, index) =>
      Math.max(key.length, ...body.map((cells) => (cells[index] ?? '').length)),
    );

    const render = (cells: string[]): string =>
      cells
        .map((text, index) => text.padEnd(widths[index] ?? 0))
        .join('  ')
        .trimEnd();

    lines.push(paint(render(header)));
    lines.push(widths.map((width) => '-'.repeat(width)).join('  '));
    for (const cells of body) lines.push(render(cells));
  }

  const suffix = envelope.truncated ? ' (truncated)' : '';
  lines.push('');
  lines.push(
    `${envelope.rowCount} row(s)${suffix} in ${envelope.elapsedMs}ms — ${envelope.project}/${envelope.env}/${envelope.db}`,
  );

  return lines.join('\n');
};

export const formatError = (err: DbqError, format: 'json' | 'table' | 'toon'): string => {
  const payload =
    err.hint === undefined
      ? { code: err.code, message: err.message }
      : { code: err.code, message: err.message, hint: err.hint };
  if (format === 'json') {
    return JSON.stringify({ error: payload }, null, 2);
  }
  if (format === 'toon') return formatToonValue({ error: payload });

  const hint = err.hint === undefined ? '' : `\nhint: ${err.hint}`;
  return `${err.code}: ${err.message}${hint}`;
};
