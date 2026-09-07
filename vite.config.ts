/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The prototype is a static bundle. `base: './'` keeps it openable from a plain
// folder or any static host without server rewrite rules.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // e2e/ is Playwright's; Vitest must not try to run those files.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
