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

  it('should be rendering the env list as a human table when requested', () => {
    const config = mkdtempSync(join(tmpdir(), 'dbq-cli-'));
    try {
      const result = runCli(['envs', '--format', 'table'], config);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('root:');
      expect(result.stdout).toContain('0 rows');
      expect(result.stdout).not.toContain('rows: []');
    } finally {
      rmSync(config, { recursive: true, force: true });
    }
  });

  it.each([
    ['--json'],
    ['--format', 'json'],
  ])('should be refusing JSON output flags before resolving a connection (%s)', (...flags) => {
    const config = mkdtempSync(join(tmpdir(), 'dbq-cli-'));
    try {
      const result = runCli(['run', '--env', 'missing', ...flags, 'SELECT 1'], config);
      expect(result.status).toBe(2);
      expect(result.stdout).toContain('USAGE');
      expect(result.stdout).toContain(
        flags[0] === '--json' ? "unknown option '--json'" : "expected 'toon' or 'table'",
      );
      expect(result.stdout).not.toContain('could not infer the project');
      expect(result.stdout).not.toContain('"error"');
      expect(result.stderr).toBe('');
    } finally {
      rmSync(config, { recursive: true, force: true });
    }
  });

  it('should be sending unknown flag errors as structured stdout with exit code 2', () => {
    const config = mkdtempSync(join(tmpdir(), 'dbq-cli-'));
    try {
      const result = runCli(['run', '--env', 'dev', '--unknown'], config);
      expect(result.status).toBe(2);
      expect(result.stdout).toContain('USAGE');
      expect(result.stdout).toContain('valid commands and flags');
      expect(result.stderr).toBe('');
    } finally {
      rmSync(config, { recursive: true, force: true });
    }
  });

  it('should be keeping errors in TOON when table output was requested', () => {
    const config = mkdtempSync(join(tmpdir(), 'dbq-cli-'));
    try {
      const result = runCli(['envs', '--format', 'table', '--unknown'], config);
      expect(result.status).toBe(2);
      expect(result.stdout).toContain('error:');
      expect(result.stdout).toContain('code: USAGE');
      expect(result.stdout).not.toContain('"error"');
      expect(result.stderr).toBe('');
    } finally {
      rmSync(config, { recursive: true, force: true });
    }
  });

  it('should be reporting unknown flags as TOON even when --json is present', () => {
    const config = mkdtempSync(join(tmpdir(), 'dbq-cli-'));
    try {
      const result = runCli(['run', '--env', 'dev', '--json', '--unknown'], config);
      expect(result.status).toBe(2);
      expect(result.stdout).toContain('code: USAGE');
      expect(result.stdout).not.toContain('"error"');
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

  it.each(['run', 'envs', 'schema', 'databases'])('should be omitting JSON formats from %s help', (command) => {
    const config = mkdtempSync(join(tmpdir(), 'dbq-cli-'));
    try {
      const result = runCli([command, '--help'], config);
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain('--json');
      expect(result.stdout).not.toContain('toon, json or table');
      expect(result.stdout).toContain('toon or table');
      expect(result.stdout).toContain('table');
      if (command !== 'envs') expect(result.stdout).toContain('--full');
    } finally {
      rmSync(config, { recursive: true, force: true });
    }
  });
});
