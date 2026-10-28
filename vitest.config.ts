/**
 * Unit/integration-test discovery and bounded worker concurrency.
 * Serial execution avoids contention between the existing SQLite corpus and document/provider fixtures.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/*.test.ts',
      'apps/**/*.test.ts',
      'apps/**/*.test.tsx',
      'scripts/**/*.test.ts',
    ],
    environment: 'node',
    // Bound CPU contention between SQLite corpora and document/provider fixtures.
    maxWorkers: 1,
    clearMocks: true,
  },
});
