import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'database',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
