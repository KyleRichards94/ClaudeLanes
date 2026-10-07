import { defineConfig } from '@playwright/test';

/** End-to-end tests drive the built app (out/) through Playwright's Electron support (design §12). */
export default defineConfig({
  testDir: './e2e',
  // Packaged-app checks run separately: `pnpm e2e:packaged` (playwright.packaged.config.ts).
  testIgnore: ['packaged/**'],
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
