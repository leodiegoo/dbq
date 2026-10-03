import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const runCli = (args: string[], xdgConfigHome: string) =>
  spawnSync(process.execPath, ['src/cli.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, XDG_CONFIG_HOME: xdgConfigHome },
  });

describe('CLI output', () => {
  it('should be showing a definitive empty state in the default format', () => {
    const config = mkdtempSync(join(tmpdir(), 'dbq-cli-'));
    try {
      const result = runCli(['envs'], config);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('rows: []');
      expect(result.stderr).toBe('');
    } finally {
      rmSync(config, { recursive: true, force: true });
    }
  });

  it('should be retaining explicit JSON output for existing parsers', () => {
    const config = mkdtempSync(join(tmpdir(), 'dbq-cli-'));
    try {
      const result = runCli(['envs', '--json'], config);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).rows).toEqual([]);
    } finally {
      rmSync(config, { recursive: true, force: true });
    }
  });

  it('should be sending unknown flag errors as structured stdout with exit code 2', () => {
    const config = mkdtempSync(join(tmpdir(), 'dbq-cli-'));
    try {
      const result = runCli(['run', '--env', 'dev', '--unknown'], config);
      expect(result.status).toBe(2);
      expect(result.stdout).toContain('code: USAGE');
      expect(result.stdout).toContain('valid commands and flags');
      expect(result.stderr).toBe('');
    } finally {
      rmSync(config, { recursive: true, force: true });
    }
  });

  it('should be retaining JSON for unknown flag errors when --json is requested', () => {
    const config = mkdtempSync(join(tmpdir(), 'dbq-cli-'));
    try {
      const result = runCli(['run', '--env', 'dev', '--json', '--unknown'], config);
      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout).error.code).toBe('USAGE');
      expect(result.stderr).toBe('');
    } finally {
      rmSync(config, { recursive: true, force: true });
    }
  });

  it('should be showing command examples and built-in defaults in the run reference', () => {
    const config = mkdtempSync(join(tmpdir(), 'dbq-cli-'));
    try {
      const result = runCli(['run', '--help'], config);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Examples:');
      expect(result.stdout).toContain('default: 500');
      expect(result.stdout).toContain('dbq run --env <env>');
    } finally {
      rmSync(config, { recursive: true, force: true });
    }
  });
});
