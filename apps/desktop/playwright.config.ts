import { defineConfig } from '@playwright/test';

// Specs start the app on a fresh profile, where first run (AL-047) would block the board; they open
// straight on it instead. first-run.spec.ts takes this out of the app's environment to test first run.
process.env['AGENT_LANES_SKIP_FIRST_RUN'] = '1';

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
