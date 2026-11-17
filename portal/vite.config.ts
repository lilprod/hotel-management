import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Resolve the workspace package from its sources: tests and dev do not need a prior build.
    alias: { '@hm/shared': fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url)) },
  },
  server: {
    port: 5175,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
  preview: {
    port: 4175,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    server: { deps: { inline: [/@hm\/ui/] } },
  },
});
