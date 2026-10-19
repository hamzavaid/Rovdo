import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'apps/**/*.test.tsx'],
    environment: 'node',
    // Bound CPU contention between SQLite corpora and document/provider fixtures.
    maxWorkers: 1,
    clearMocks: true,
  },
});
