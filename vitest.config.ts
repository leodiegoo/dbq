import { defineConfig } from 'vitest/config';

export const config = defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});

export default config;
