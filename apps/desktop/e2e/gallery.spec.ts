import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { auditTargets, seriousAxeViolations } from './support/accessibility';
import { appDir, buildGallery, launchGallery, type GalleryApp } from './support/gallery-build';

/** The e2e tsconfig has no DOM types, so the renderer's `location` is reached through `globalThis`. */
type RendererScope = { location: { hash: string } };

/** Opens a route by its location hash, the way a developer reaches the gallery in `pnpm dev`. */
async function openHash(page: Page, hash: string) {
  await page.evaluate((value) => {
    (globalThis as unknown as RendererScope).location.hash = value;
  }, hash);
}

test.describe('component gallery (AL-032)', () => {
  test('is left out of the production build', async () => {
    const assets = readdirSync(join(appDir, 'out', 'renderer', 'assets'));
    expect(assets.some((file) => file.startsWith('page-board-'))).toBe(true);
    expect(assets.some((file) => file.startsWith('page-gallery-'))).toBe(false);

    const userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-'));
    const app = await electron.launch({ args: [appDir], env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir } });
    try {
      const page = await app.firstWindow();
      await expect(page.getByText('Agent board')).toBeVisible();
      await openHash(page, '#/gallery');
      // The hash names no route here, so the router puts the board's back and the board stays.
      await expect.poll(() => page.evaluate(() => (globalThis as unknown as RendererScope).location.hash)).toBe('#/board');
      await expect(page.getByText('Agent board')).toBeVisible();
      await expect(page.getByTestId('gallery-page')).toHaveCount(0);
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test.describe('in a build that has it', () => {
    let gallery: GalleryApp;
    let page: Page;

    test.beforeAll(async () => {
      test.setTimeout(180_000);
      buildGallery();
      gallery = await launchGallery();
      page = await gallery.app.firstWindow();
      await expect(page.getByText('Agent board')).toBeVisible();
      await openHash(page, '#/gallery');
      await expect(page.getByTestId('gallery-page')).toBeVisible();
    });

    test.afterAll(async () => {
      await gallery?.close();
    });

    test('shows the tokens sheet and every card state, for checking against artboards 7 and 6', async () => {
      await expect(page.getByRole('heading', { name: 'Design tokens' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Agent card states' })).toBeVisible();
      for (const state of ['Running', 'Selected', 'Needs approval', 'Model switching', 'Build failed', 'QA gap', 'PR open', 'Merged']) {
        await expect(page.getByRole('heading', { name: state, exact: true })).toBeVisible();
      }

      const results = join(appDir, 'test-results');
      await page.getByTestId('gallery-tokens').screenshot({ path: join(results, 'gallery-07-design-tokens.png') });
      await page.getByTestId('gallery-card-states').screenshot({ path: join(results, 'gallery-06-card-states.png') });
      await page.getByTestId('gallery-primitives').screenshot({ path: join(results, 'gallery-primitives.png') });
    });

    test('opens the gallery modals: Esc closes the normal one only', async () => {
      await page.getByTestId('gallery-open-modal').click();
      await expect(page.getByRole('dialog', { name: 'Connections' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Connections' })).toHaveCount(0);

      await page.getByTestId('gallery-open-blocking-modal').click();
      const blocking = page.getByRole('dialog', { name: 'Connect Agent Lanes' });
      await expect(blocking).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(blocking).toBeVisible();
      await blocking.getByRole('button', { name: 'Finish' }).click();
      await expect(blocking).toHaveCount(0);
    });

    test('has no serious axe violations (AL-033)', async () => {
      expect(await seriousAxeViolations(page)).toEqual([]);
    });

    test('has no serious axe violations with each modal open (AL-033)', async () => {
      await page.getByTestId('gallery-open-modal').click();
      await expect(page.getByRole('dialog', { name: 'Connections' })).toBeVisible();
      expect(await seriousAxeViolations(page)).toEqual([]);
      await page.keyboard.press('Escape');

      await page.getByTestId('gallery-open-blocking-modal').click();
      const blocking = page.getByRole('dialog', { name: 'Connect Agent Lanes' });
      await expect(blocking).toBeVisible();
      expect(await seriousAxeViolations(page)).toEqual([]);
      await blocking.getByRole('button', { name: 'Finish' }).click();
    });

    test('gives every control a target of at least 44 × 44 px (AL-033)', async () => {
      const audit = await auditTargets(page);
      // Buttons, tabs, segments, switches and fields across the primitives sheet.
      expect(audit.checked).toBeGreaterThan(40);
      expect(audit.small).toEqual([]);
    });
  });
});
