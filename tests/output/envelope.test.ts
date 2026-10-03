import { describe, expect, it } from 'vitest';
import { applyLimit, formatError, formatTable, formatToon, truncateContent, type Envelope } from '../../src/output/envelope.ts';
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

describe('formatToon', () => {
  it('should be encoding row arrays as a compact table with metadata', () => {
    expect(formatToon(envelope([{ id: 1, name: 'Ada' }, { id: 2, name: 'Lin' }]))).toBe(
      'project: proj\nenv: dev\ndb: mysql\nengine: mysql\nrowCount: 2\ntruncated: false\nelapsedMs: 12\nrows[2]{id,name}:\n  1,Ada\n  2,Lin',
    );
  });

  it('should be reporting an explicit empty result', () => {
    expect(formatToon(envelope([]))).toContain('rows: []');
  });
});

describe('formatTable', () => {
  it('should be rendering a header with every key found across rows', () => {
    const out = formatTable(envelope([{ a: 1 }, { b: 2 }]), false);
    expect(out).toContain('a');
    expect(out).toContain('b');
  });

  it('should be announcing truncation', () => {
    expect(formatTable(envelope([{ a: 1 }], true), false)).toContain('truncated');
  });

  it('should be reporting an empty result instead of an empty table', () => {
    expect(formatTable(envelope([]), false)).toContain('0 rows');
  });

  it('should be omitting ansi when colour is disabled', () => {
    expect(formatTable(envelope([{ a: 1 }]), false)).not.toContain('\u001b');
  });
});

describe('formatError', () => {
  it('should be encoding a structured TOON error with its corrective hint', () => {
    expect(formatError(new DbqError('USAGE', 'unknown flag', 'valid flags: --env'))).toBe(
      'error:\n  code: USAGE\n  message: unknown flag\n  hint: "valid flags: --env"',
    );
  });

  it('should be omitting the hint key when there is none', () => {
    expect(formatError(new DbqError('USAGE', 'x'))).toBe('error:\n  code: USAGE\n  message: x');
  });
});

describe('truncateContent', () => {
  it('should be preserving short text and marking the full size of long text', () => {
    expect(truncateContent({ note: 'abcdefghij' }, false, 5)).toEqual({
      value: { note: 'abcde… (truncated; 10 characters total; use --full)' },
      truncated: true,
    });
  });

  it('should be returning the complete text when --full is enabled', () => {
    expect(truncateContent({ note: 'abcdefghij' }, true, 5)).toEqual({
      value: { note: 'abcdefghij' },
      truncated: false,
    });
  });
});
