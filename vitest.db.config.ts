/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Database integration tests, kept separate from the unit suite so `npm test`
 * stays fast and runnable with no services. These need a real PostgreSQL 16
 * server; see docs/DATABASE.md.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['db-tests/**/*.test.ts'],
    // Migrations rebuild the schema; parallel files would fight over it.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
