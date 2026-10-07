import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type CDPSession,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

/**
 * AL-021 bundled fonts (design §11 Type): Plus Jakarta Sans 500/700/800 and JetBrains Mono 400 ship
 * inside the app, render with the network disabled, and their OFL licences ship with the package.
 */

const appDir = join(__dirname, '..');

/** The few DOM members the in-page callbacks use (the e2e tsconfig has no DOM lib). */
interface PageGlobals {
  document: {
    fonts: { ready: Promise<unknown> };
    body: { append(node: unknown): void };
    createElement(tag: 'span'): {
      dataset: Record<string, string>;
      style: { fontFamily: string; fontWeight: string };
      textContent: string | null;
    };
  };
}

let app: ElectronApplication;
let page: Page;
let cdp: CDPSession;
let userDataDir: string;
const fontRequests: string[] = [];

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-'));
  app = await electron.launch({
    args: [appDir],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
  });
  page = await app.firstWindow();

  // Network off for the whole session: offline emulation, and every http(s)/ws(s) request is
  // cancelled and recorded, so anything that reaches for the network shows up in the test.
  await app.evaluate(({ session }) => {
    const blocked: string[] = [];
    (globalThis as { blockedRequests?: string[] }).blockedRequests = blocked;
    session.defaultSession.enableNetworkEmulation({ offline: true });
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (details, callback) => {
        blocked.push(details.url);
        callback({ cancel: true });
      },
    );
  });

  // Reload with the cache off so every font is fetched again while offline.
  cdp = await app.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  page.on('request', (request) => {
    if (request.resourceType() === 'font') fontRequests.push(request.url());
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Agent board' })).toBeVisible();
  await page.evaluate(() => (globalThis as unknown as PageGlobals).document.fonts.ready.then(() => undefined));

  // CSS.getPlatformFontsForNode reports the font Chromium really drew with, not just the CSS stack.
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

/** The platform fonts Chromium actually used to draw the text inside the element matching `selector`. */
async function renderedFonts(selector: string) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  expect(nodeId, `no element matches ${selector}`).toBeGreaterThan(0);
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  return fonts.map(({ postScriptName, isCustomFont }) => ({ postScriptName, isCustomFont }));
}

/** Adds a text sample in the given font to the page, for text the board does not show yet. */
async function addSample(id: string, text: string, style: { fontFamily: string; fontWeight: string }) {
  await page.evaluate(
    ({ id: sampleId, text: sampleText, style: sampleStyle }) => {
      const { document } = globalThis as unknown as PageGlobals;
      const sample = document.createElement('span');
      sample.dataset['fontSample'] = sampleId;
      sample.style.fontFamily = sampleStyle.fontFamily;
      sample.style.fontWeight = sampleStyle.fontWeight;
      sample.textContent = sampleText;
      document.body.append(sample);
      return document.fonts.ready.then(() => undefined);
    },
    { id, text, style },
  );
  return `[data-font-sample="${id}"]`;
}

test.describe('with the network disabled', () => {
  test('nothing reaches for the network', async () => {
    const blocked = await app.evaluate(() => (globalThis as { blockedRequests?: string[] }).blockedRequests ?? []);
    expect(blocked).toEqual([]);
  });

  test('fonts load from the app bundle only', async () => {
    expect(fontRequests.length).toBeGreaterThan(0);
    for (const url of fontRequests) {
      expect(url).toMatch(/^file:\/\/\/.+\/out\/renderer\/assets\/[^/]+\.woff2$/);
    }
  });

  test('the board title renders in Plus Jakarta Sans 800', async () => {
    const title = page.getByRole('heading', { name: 'Agent board' });
    await expect(title).toHaveCSS('font-weight', '800');
    await title.evaluate((element) => element.setAttribute('data-font-probe', 'board-title'));

    expect(await renderedFonts('[data-font-probe="board-title"]')).toEqual([
      { postScriptName: 'PlusJakartaSans-ExtraBold', isCustomFont: true },
    ]);

    await page.screenshot({ path: join(appDir, 'test-results', 'fonts-offline.png') });
  });

  test('mono text (runtime line, ids, branches) renders in JetBrains Mono', async () => {
    expect(await renderedFonts('[data-testid="runtime-info"]')).toEqual([
      { postScriptName: 'JetBrainsMono-Regular', isCustomFont: true },
    ]);

    // Work item ids and branch names arrive with later tickets (IdChip, cards); sample their glyphs.
    const ids = await addSample('ids', '#71273 · feature/AL-71273-fix-job-grid · sub/AL-71273-api', {
      fontFamily: 'var(--al-font-mono)',
      fontWeight: '400',
    });
    expect(await renderedFonts(ids)).toEqual([{ postScriptName: 'JetBrainsMono-Regular', isCustomFont: true }]);
  });

  test('body and heading weights render from the bundled 500 and 700 faces', async () => {
    const body = await addSample('body', 'Needs you · approve plan', {
      fontFamily: 'var(--al-font-sans)',
      fontWeight: '500',
    });
    const heading = await addSample('heading', 'Fix job grid paging', {
      fontFamily: 'var(--al-font-sans)',
      fontWeight: '700',
    });

    expect(await renderedFonts(body)).toEqual([{ postScriptName: 'PlusJakartaSans-Medium', isCustomFont: true }]);
    expect(await renderedFonts(heading)).toEqual([{ postScriptName: 'PlusJakartaSans-Bold', isCustomFont: true }]);
  });
});

test.describe('font licences', () => {
  const localRequire = createRequire(__filename);
  const normalise = (text: string) => text.replace(/\r\n/g, '\n').trim();

  /** Each bundled font package and the OFL text that ships for it from apps/desktop/licenses. */
  const licenceFiles: Record<string, string> = {
    '@fontsource/plus-jakarta-sans': 'licenses/fonts/PlusJakartaSans-OFL.txt',
    '@fontsource/jetbrains-mono': 'licenses/fonts/JetBrainsMono-OFL.txt',
  };

  test('every bundled font has its OFL licence, matching the installed package', () => {
    const manifest = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const fontPackages = Object.keys(manifest.dependencies).filter((name) => name.startsWith('@fontsource'));
    expect(fontPackages.sort()).toEqual(Object.keys(licenceFiles).sort());

    for (const [fontPackage, licenceFile] of Object.entries(licenceFiles)) {
      const shipped = normalise(readFileSync(join(appDir, licenceFile), 'utf8'));
      const upstream = normalise(readFileSync(localRequire.resolve(`${fontPackage}/LICENSE`), 'utf8'));
      expect(shipped, `${licenceFile} is out of date with ${fontPackage}`).toBe(upstream);
      expect(shipped).toContain('SIL Open Font License, Version 1.1');
    }
  });

  test('the installer copies the licences next to the app', () => {
    const builderConfig = readFileSync(join(appDir, 'electron-builder.yml'), 'utf8').replace(/\r\n/g, '\n');
    expect(builderConfig).toMatch(/^extraFiles:\n {2}- from: licenses\n {4}to: licenses$/m);
  });
});
