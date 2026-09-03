import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configRoot, listEnvs, listProjects, resolveProject } from '../../src/config/resolveProject.ts';
import { DbqError } from '../../src/errors.ts';

const temps: string[] = [];
const makeTemp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbq-'));
  temps.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('configRoot', () => {
  it('should be honouring XDG_CONFIG_HOME when set', () => {
    expect(configRoot({ XDG_CONFIG_HOME: '/custom', HOME: '/home/leo' })).toBe('/custom/dbq');
  });

  it('should be falling back to ~/.config when XDG is unset', () => {
    expect(configRoot({ HOME: '/home/leo' })).toBe('/home/leo/.config/dbq');
  });
});

describe('listProjects and listEnvs', () => {
  it('should be listing project directories and their env files sorted', () => {
    const root = makeTemp();
    mkdirSync(join(root, 'my-project'), { recursive: true });
    mkdirSync(join(root, 'alpha'), { recursive: true });
    writeFileSync(join(root, 'my-project', 'prod.json'), '{}');
    writeFileSync(join(root, 'my-project', 'dev.json'), '{}');
    writeFileSync(join(root, 'my-project', 'notes.txt'), 'x');

    expect(listProjects(root)).toEqual(['alpha', 'my-project']);
    expect(listEnvs(root, 'my-project')).toEqual(['dev', 'prod']);
  });

  it('should be returning an empty list when the root does not exist', () => {
    expect(listProjects(join(makeTemp(), 'ausente'))).toEqual([]);
    expect(listEnvs(makeTemp(), 'ausente')).toEqual([]);
  });
});

describe('resolveProject', () => {
  it('should be preferring the explicit project over cwd detection', () => {
    const root = makeTemp();
    mkdirSync(join(root, 'alpha'), { recursive: true });
    expect(resolveProject({ explicit: 'alpha', cwd: '/qualquer/lugar', root })).toBe('alpha');
  });

  it('should be refusing an explicit project that has no config directory', () => {
    const root = makeTemp();
    mkdirSync(join(root, 'alpha'), { recursive: true });
    expect(() => resolveProject({ explicit: 'beta', cwd: '/x', root })).toThrowError(DbqError);
  });

  it('should be detecting the project from the git root basename', () => {
    const root = makeTemp();
    mkdirSync(join(root, 'meu-repo'), { recursive: true });

    const workspace = makeTemp();
    const repo = join(workspace, 'meu-repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    const nested = join(repo, 'src', 'deep');
    mkdirSync(nested, { recursive: true });

    expect(resolveProject({ cwd: nested, root })).toBe('meu-repo');
  });

  it('should be falling back to the cwd basename when there is no git root', () => {
    const root = makeTemp();
    mkdirSync(join(root, 'solto'), { recursive: true });

    const workspace = makeTemp();
    const dir = join(workspace, 'solto');
    mkdirSync(dir, { recursive: true });

    expect(resolveProject({ cwd: dir, root })).toBe('solto');
  });

  it('should be failing with the available projects listed in the message', () => {
    const root = makeTemp();
    mkdirSync(join(root, 'alpha'), { recursive: true });
    mkdirSync(join(root, 'beta'), { recursive: true });

    const workspace = makeTemp();
    const dir = join(workspace, 'desconhecido');
    mkdirSync(dir, { recursive: true });

    try {
      resolveProject({ cwd: dir, root });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as DbqError).code).toBe('USAGE');
      expect((err as DbqError).message).toContain('alpha');
      expect((err as DbqError).message).toContain('beta');
    }
  });
});
