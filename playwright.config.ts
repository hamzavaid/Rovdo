/**
 * Electron/Chromium acceptance-test configuration.
 * Run serially against built bundles; automatic artifacts are disabled to avoid collecting incidental private data.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: 'list',
  use: { trace: 'off', screenshot: 'off', video: 'off' },
});
