import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    environment: 'jsdom',
    exclude: ['**/node_modules/**', '**/dist/**', 'src/e2e/browser/**'],
    environmentMatchGlobs: [
      ['src/server/**', 'node'],
      ['src/e2e/*.test.ts', 'node'],
      ['server.test.ts', 'node'],
      ['scripts/**', 'node'],
    ],
  },
});
