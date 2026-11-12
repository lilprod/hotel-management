import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
  preview: {
    port: 4174,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    server: { deps: { inline: [/antd/, /@ant-design/, /@hm\/ui/] } },
  },
});
