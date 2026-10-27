import { execFileSync } from 'node:child_process';

export const setup = () => {
  execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
};
