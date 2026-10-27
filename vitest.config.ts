import { defineConfig } from 'vitest/config';

export const config = defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/globalSetup.ts'],
  },
});

export default config;
