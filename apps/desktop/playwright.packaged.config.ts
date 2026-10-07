import { defineConfig } from '@playwright/test';

/**
 * Checks the packaged app and its installer (ticket AL-007): `pnpm e2e:packaged` packages, then runs
 * e2e/packaged against release/<version>/. Kept apart from `pnpm e2e` because packaging takes minutes
 * and about 1 GB of disk.
 */
export default defineConfig({
  testDir: './e2e/packaged',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
