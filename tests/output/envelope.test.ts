import { describe, expect, it } from 'vitest';
import { applyLimit, formatError, formatJson, formatTable, type Envelope } from '../../src/output/envelope.ts';
import { DbqError } from '../../src/errors.ts';

const envelope = (rows: unknown[], truncated = false): Envelope => ({
  project: 'proj',
  env: 'dev',
  db: 'mysql',
  engine: 'mysql',
  rowCount: rows.length,
  truncated,
  elapsedMs: 12,
  rows,
});

describe('applyLimit', () => {
  it('should be leaving the rows untouched when below the limit', () => {
    expect(applyLimit([1, 2], 5)).toEqual({ rows: [1, 2], truncated: false });
  });

  it('should not be truncating when the count matches the limit exactly', () => {
    expect(applyLimit([1, 2, 3], 3)).toEqual({ rows: [1, 2, 3], truncated: false });
  });

  it('should be cutting and flagging when the fetched extra row is present', () => {
    expect(applyLimit([1, 2, 3, 4], 3)).toEqual({ rows: [1, 2, 3], truncated: true });
  });

  it('should be treating limit zero as uncapped', () => {
    expect(applyLimit([1, 2, 3], 0)).toEqual({ rows: [1, 2, 3], truncated: false });
  });
});

describe('formatJson', () => {
  it('should be emitting parseable json carrying the metadata', () => {
    const parsed = JSON.parse(formatJson(envelope([{ id: 1 }], true)));
    expect(parsed.rows).toEqual([{ id: 1 }]);
    expect(parsed.truncated).toBe(true);
    expect(parsed.engine).toBe('mysql');
  });

  it('should be serialising a regexp and a date without throwing', () => {
    const parsed = JSON.parse(formatJson(envelope([{ r: /a/i, d: new Date('2020-01-02T03:04:05Z') }])));
    expect(parsed.rows[0].r).toBe('/a/i');
    expect(parsed.rows[0].d).toBe('2020-01-02T03:04:05.000Z');
  });

  it('should never be emitting ansi escapes', () => {
    expect(formatJson(envelope([{ id: 1 }]))).not.toContain('\u001b');
  });
});

describe('formatTable', () => {
  it('should be rendering a header with every key found across rows', () => {
    const out = formatTable(envelope([{ a: 1 }, { b: 2 }]), false);
    expect(out).toContain('a');
    expect(out).toContain('b');
  });

  it('should be announcing truncation', () => {
    expect(formatTable(envelope([{ a: 1 }], true), false)).toContain('truncado');
  });

  it('should be reporting an empty result instead of an empty table', () => {
    expect(formatTable(envelope([]), false)).toContain('0 linhas');
  });

  it('should be omitting ansi when colour is disabled', () => {
    expect(formatTable(envelope([{ a: 1 }]), false)).not.toContain('\u001b');
  });
});

describe('formatError', () => {
  it('should be emitting a parseable json error carrying code, message and hint', () => {
    const parsed = JSON.parse(formatError(new DbqError('READONLY_VIOLATION', 'nao permitido', 'use find'), 'json'));
    expect(parsed.error.code).toBe('READONLY_VIOLATION');
    expect(parsed.error.message).toBe('nao permitido');
    expect(parsed.error.hint).toBe('use find');
  });

  it('should be omitting the hint key when there is none', () => {
    const parsed = JSON.parse(formatError(new DbqError('USAGE', 'x'), 'json'));
    expect('hint' in parsed.error).toBe(false);
  });

  it('should be rendering plain text for the table format', () => {
    const out = formatError(new DbqError('TIMEOUT', 'estourou', 'filtre mais'), 'table');
    expect(out).toContain('TIMEOUT');
    expect(out).toContain('filtre mais');
  });
});
