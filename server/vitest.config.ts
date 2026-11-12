import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    // Test against workspace sources: no prior build of @hm/database / @hm/shared required.
    alias: {
      '@hm/database': src('../database/src/index.ts'),
      '@hm/shared': src('../packages/shared/src/index.ts'),
    },
  },
  test: {
    name: 'server',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
