import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DbqError } from '../errors.ts';

export const configRoot = (env: NodeJS.ProcessEnv = process.env): string => {
  const base = env.XDG_CONFIG_HOME ?? join(env.HOME ?? '', '.config');
  return join(base, 'dbq');
};

export const listProjects = (root: string): string[] => {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
};

export const listEnvs = (root: string, project: string): string[] => {
  const dir = join(root, project);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.replace(/\.json$/, ''))
    .sort();
};

const gitRoot = (cwd: string): string | undefined => {
  let current = cwd;
  for (;;) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
};

export const resolveProject = (opts: { explicit?: string; cwd: string; root: string }): string => {
  const available = listProjects(opts.root);
  const lista = available.length > 0 ? available.join(', ') : '(nenhum)';

  if (opts.explicit !== undefined) {
    if (!available.includes(opts.explicit)) {
      throw new DbqError(
        'USAGE',
        `projeto '${opts.explicit}' nao encontrado em ${opts.root}. Disponiveis: ${lista}`,
        `crie ${join(opts.root, opts.explicit)}/<env>.json`,
      );
    }
    return opts.explicit;
  }

  const candidate = basename(gitRoot(opts.cwd) ?? opts.cwd);
  if (available.includes(candidate)) return candidate;

  throw new DbqError(
    'USAGE',
    `nao foi possivel inferir o projeto a partir de '${opts.cwd}'. Disponiveis: ${lista}`,
    'passe --project <nome>',
  );
};
