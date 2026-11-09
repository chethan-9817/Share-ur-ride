import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/env.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Each file gets its own in-memory Postgres; run files in separate forks.
    pool: 'forks',
  },
});
