import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';

/**
 * AL-023 Text primitives in the real renderer: variants reach Chromium as the design's type, and
 * `selectable` text can really be selected (design §13: text selection in logs is a react-native-web
 * risk), while labels stay unselectable.
 */

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-'));
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
  });
  page = await app.firstWindow();
  await expect(page.getByTestId('runtime-info')).toContainText('v0.1.0 · Electron');
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

/** The page's current text selection (the e2e tsconfig has no DOM lib). */
function selectedText(): Promise<string> {
  return page.evaluate(() => {
    const scope = globalThis as unknown as { getSelection(): { toString(): string } | null };
    return scope.getSelection()?.toString() ?? '';
  });
}

function clearSelection(): Promise<void> {
  return page.evaluate(() => {
    const scope = globalThis as unknown as { getSelection(): { removeAllRanges(): void } | null };
    scope.getSelection()?.removeAllRanges();
  });
}

/** Drags the mouse across the element's text, as a user selecting it would. */
async function dragAcross(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element is not visible');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 1, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, y, { steps: 8 });
  await page.mouse.up();
}

test('display and mono variants reach Chromium as the design type', async () => {
  const title = page.getByRole('heading', { name: 'Agent board' });
  await expect(title).toHaveCSS('font-size', '40px');
  await expect(title).toHaveCSS('font-weight', '800');
  await expect(title).toHaveCSS('letter-spacing', '-1px');
  await expect(title).toHaveCSS('line-height', '44px');

  const runtime = page.getByTestId('runtime-info');
  await expect(runtime).toHaveCSS('font-family', /^"JetBrains Mono"/);
  await expect(runtime).toHaveCSS('font-size', '12px');
  await expect(runtime).toHaveCSS('color', 'rgb(91, 107, 130)'); // color.muted
});

test('selectable text can be selected with the mouse', async () => {
  const runtime = page.getByTestId('runtime-info');
  await expect(runtime).toHaveCSS('user-select', 'text');

  await clearSelection();
  await dragAcross(runtime);
  expect(await selectedText()).toContain('Electron');

  await clearSelection();
  await runtime.click({ clickCount: 3 });
  expect((await selectedText()).trim()).toBe((await runtime.innerText()).trim());

  await page.screenshot({ path: join(__dirname, '..', 'test-results', 'text-selectable.png') });
  await clearSelection();
});

test('labels are not selectable by default', async () => {
  const title = page.getByRole('heading', { name: 'Agent board' });
  await expect(title).toHaveCSS('user-select', 'none');

  await clearSelection();
  await dragAcross(title);
  expect(await selectedText()).toBe('');
  await title.click({ clickCount: 3 });
  expect(await selectedText()).not.toContain('Agent board');
});
