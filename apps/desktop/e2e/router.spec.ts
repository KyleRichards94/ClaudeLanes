import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { e2eTicketRecord, seedTicketRecords } from './support/ticket-records';

/** AL-140: typed router, lazy pages, browser-style Back and Forward. */
const rendererOut = join(__dirname, '..', 'out', 'renderer');
const pageSlices = ['board', 'ticket', 'design-tab'] as const;

function readAsset(name: string): string {
  return readFileSync(join(rendererOut, 'assets', name), 'utf8');
}

/** `import … from "./x.js"`, `export … from "./x.js"` and `import "./x.js"`; never `import("./x.js")`. */
function staticImports(code: string): string[] {
  return [...code.matchAll(/(?:\bfrom\s*|\bimport\s*)["'](\.\/[^"']+)["']/g)].map((match) => match[1] ?? '');
}

test('each page is its own chunk, reached only by dynamic import', () => {
  const html = readFileSync(join(rendererOut, 'index.html'), 'utf8');
  const entryName = /<script[^>]*\bsrc="\.\/assets\/([^"]+\.js)"/.exec(html)?.[1] ?? '';
  const scripts = readdirSync(join(rendererOut, 'assets')).filter((name) => name.endsWith('.js'));
  const entry = readAsset(entryName);

  for (const slice of pageSlices) {
    const chunks = scripts.filter((name) => new RegExp(`^page-${slice}-[\\w-]+\\.js$`).test(name));
    expect(chunks, `one chunk for pages/${slice}`).toHaveLength(1);
    expect(entry, `the entry loads pages/${slice} with import()`).toContain(`import("./${chunks[0]}")`);
  }

  // No chunk pulls a page in eagerly: the entry, shared chunks and the pages themselves.
  for (const script of scripts) {
    const eagerPages = staticImports(readAsset(script)).filter((path) => path.startsWith('./page-'));
    expect(eagerPages, `${script} imports no page statically`).toEqual([]);
  }
});

test.describe('in the app', () => {
  let app: ElectronApplication;
  let page: Page;
  let userDataDir: string;
  /** File names of everything the renderer has requested (Resource Timing skips file:// loads). */
  const requested: string[] = [];

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-router-'));
    seedTicketRecords(userDataDir, [e2eTicketRecord()]);
    app = await electron.launch({
      args: [join(__dirname, '..')],
      env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
    });
    app.context().on('request', (request) => requested.push(request.url().split('/').pop() ?? ''));
    page = await app.firstWindow();
  });

  test.afterAll(async () => {
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  const wasRequested = (slice: string) => requested.some((name) => name.startsWith(`page-${slice}-`));

  /** The e2e tsconfig has no DOM types, so the renderer's `location` is reached through `globalThis`. */
  type RendererScope = { location: { hash: string } };

  const currentHash = () => page.evaluate(() => (globalThis as unknown as RendererScope).location.hash);

  /** Opens a route the way a link or a reload would: through the location hash. */
  async function openHash(hash: string) {
    await page.evaluate((next) => {
      (globalThis as unknown as RendererScope).location.hash = next;
    }, hash);
  }

  /** A real side-button click through Chromium's input pipeline (Playwright's mouse has no back/forward). */
  async function sideButton(button: 'back' | 'forward') {
    const cdp = await page.context().newCDPSession(page);
    const at = { x: 400, y: 400, button, clickCount: 1 } as const;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at });
    await cdp.detach();
  }

  test('opens at the board and loads each other page only when it is visited', async () => {
    await expect(page.getByText('Agent board')).toBeVisible();
    expect(await currentHash()).toBe('#/board');
    expect(wasRequested('board')).toBe(true);
    expect(wasRequested('ticket')).toBe(false);
    expect(wasRequested('design-tab')).toBe(false);

    await openHash('#/ticket/71273');
    await expect(page.getByTestId('ticket-page')).toBeVisible();
    await expect(page.getByTestId('ticket-breadcrumb')).toHaveText('onsite-companion / #71273');
    expect(wasRequested('ticket')).toBe(true);
    expect(wasRequested('design-tab')).toBe(false);
  });

  test('goes back and forward with Alt+arrows and the mouse side buttons', async () => {
    await openHash('#/ticket/71273');
    await expect(page.getByTestId('ticket-page')).toBeVisible();

    await page.getByRole('tab', { name: 'Claude Design' }).click();
    await expect(page.getByTestId('design-tab-page')).toBeVisible();
    expect(await currentHash()).toBe('#/ticket/71273/design');

    await page.keyboard.press('Alt+ArrowLeft');
    await expect(page.getByTestId('ticket-page')).toBeVisible();

    await sideButton('back');
    await expect(page.getByText('Agent board')).toBeVisible();

    await sideButton('forward');
    await expect(page.getByTestId('ticket-page')).toBeVisible();

    await page.keyboard.press('Alt+ArrowRight');
    await expect(page.getByTestId('design-tab-page')).toBeVisible();

    await page.getByText('← Board').click();
    await expect(page.getByText('Agent board')).toBeVisible();
  });

  test('a reload reopens the same page', async () => {
    await openHash('#/ticket/71273/design');
    await expect(page.getByTestId('design-tab-page')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('design-tab-page')).toBeVisible();
    await expect(page.getByText('#71273')).toBeVisible();
  });
});
