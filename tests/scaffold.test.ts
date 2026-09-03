import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('scaffold', () => {
  it('should be configured as ESM with a dbq bin pointing at the TS entrypoint', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.type).toBe('module');
    expect(pkg.bin.dbq).toBe('./src/cli.ts');
  });
});
