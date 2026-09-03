import pc from 'picocolors';
import type { DbqError } from '../errors.ts';

export type Envelope = {
  project: string;
  env: string;
  db: string;
  engine: 'mysql' | 'mongodb';
  rowCount: number;
  truncated: boolean;
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
const replacer = function (this: unknown, key: string, value: unknown): unknown {
  // JSON.stringify calls toJSON before the replacer, so a Date arrives as a
  // string: the raw value has to come from the parent object.
  const original = (this as Record<string, unknown>)[key];
  if (original instanceof Date) return original.toISOString();
  if (original instanceof RegExp) return original.toString();
  if (typeof original === 'bigint') return original.toString();
  if (original instanceof Uint8Array) return Buffer.from(original).toString('base64');
  return value;
};

export const formatJson = (envelope: Envelope): string => JSON.stringify(envelope, replacer, 2);

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

export const formatError = (err: DbqError, format: 'json' | 'table'): string => {
  if (format === 'json') {
    const payload =
      err.hint === undefined
        ? { code: err.code, message: err.message }
        : { code: err.code, message: err.message, hint: err.hint };
    return JSON.stringify({ error: payload }, null, 2);
  }

  const hint = err.hint === undefined ? '' : `\nhint: ${err.hint}`;
  return `${err.code}: ${err.message}${hint}`;
};
