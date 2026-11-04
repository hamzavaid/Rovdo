/**
 * Electron/Chromium acceptance-test configuration.
 * Run serially against built bundles; automatic artifacts are disabled to avoid collecting incidental private data.
 */
import { defineConfig } from '@playwright/test';

// Fixture apps must never start unmocked archive traffic in the background.
process.env.ROVDO_OFFLINE_FIXTURES = '1';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: 'list',
  use: { trace: 'off', screenshot: 'off', video: 'off' },
});
