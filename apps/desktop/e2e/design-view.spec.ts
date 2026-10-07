import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { INVOKE_CHANNEL_NAMES } from '@agent-lanes/contracts/names';

/**
 * AL-191: the Claude Design view service, against a local stand-in for claude.ai (the AL-190 fake-site
 * pattern). `AGENT_LANES_DESIGN_TEST_ORIGIN` makes the unpackaged app treat the fake site as claude.ai;
 * claude.ai itself is never contacted.
 */

interface InvokeResult {
  ok: boolean;
  code?: string;
  data?: unknown;
}

interface ViewState {
  ticketId: string;
  status: string;
  url: string | null;
  visible: boolean;
}

const BOUNDS = { x: 200, y: 120, width: 800, height: 520 };

function startFakeClaude(): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const html = (body: string, headers: Record<string, string> = {}): void => {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        // claude.ai refuses to be framed; the view is a top-level page, so this must not matter.
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "frame-ancestors 'none'",
        ...headers,
      });
      response.end(body);
    };
    const path = (request.url ?? '/').split('?')[0];

    switch (path) {
      case '/design/p/canvas-a':
        // A tall canvas with a chat box. `loads` counts page loads in this tab, so a reload shows.
        return html(
          '<!doctype html><title>Canvas A</title><style>body{margin:0;height:5000px}</style>' +
            '<p id="artboard">JobControl · desktop 1440×900</p><textarea id="draft"></textarea>' +
            '<script>window.loadId = String(Math.random()); sessionStorage.loads = String(Number(sessionStorage.loads || 0) + 1);</script>',
        );
      case '/design/p/canvas-b':
        return html('<!doctype html><title>Canvas B</title><p>canvas b</p>');
      case '/design/p/probe':
        return html('<!doctype html><title>Probe</title><p>probe</p>');
      case '/design/p/signed-out':
        // What claude.ai does without a session: redirect to its sign-in page.
        response.writeHead(302, { Location: '/login?returnTo=%2Fdesign%2Fp%2Fsigned-out' });
        return response.end();
      case '/login':
        return html('<!doctype html><title>Sign in</title><p>sign in</p>');
      default:
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        return response.end('not found');
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

// Later tests build on the views earlier ones opened (the live-view limit test counts them).
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
let fake: { server: Server; origin: string };

test.beforeAll(async () => {
  fake = await startFakeClaude();
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-design-view-'));
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir, AGENT_LANES_DESIGN_TEST_ORIGIN: fake.origin },
  });
  page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();

  // Links the view hands to the OS browser are recorded instead of opening a real browser.
  const patched = await app.evaluate(({ shell }) => {
    const probe = globalThis as unknown as { openedExternally: string[] };
    probe.openedExternally = [];
    shell.openExternal = async (url: string) => {
      probe.openedExternally.push(url);
    };
    return shell.openExternal.toString().includes('openedExternally');
  });
  expect(patched).toBe(true);
});

test.afterAll(async () => {
  await app?.close();
  await new Promise((resolve) => fake?.server.close(resolve));
  rmSync(userDataDir, { recursive: true, force: true });
});

/** Calls a channel the way the renderer does, through the preload bridge. */
function invoke(channel: string, payload: unknown): Promise<InvokeResult> {
  return page.evaluate(
    ([name, body]) => (globalThis as unknown as { agentLanes: { invoke(c: string, p: unknown): Promise<InvokeResult> } }).agentLanes.invoke(name, body),
    [channel, payload] as const,
  );
}

async function viewState(ticketId: string): Promise<ViewState | null> {
  const result = await invoke('design:getView', { ticketId });
  expect(result.ok).toBe(true);
  return (result.data as { view: ViewState | null }).view;
}

/** Runs script in the design view showing `url`, from main. */
function inView<T>(url: string, script: string): Promise<T> {
  return app.evaluate(
    async ({ webContents }, [pageUrl, code]) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === pageUrl);
      if (!contents) throw new Error(`no view shows ${pageUrl}`);
      return (await contents.executeJavaScript(code, true)) as T;
    },
    [url, script] as const,
  );
}

/** The design view's id, visibility and bounds as main sees them. */
function nativeView(url: string) {
  return app.evaluate(
    ({ BrowserWindow }, pageUrl) => {
      const window = BrowserWindow.getAllWindows()[0];
      const view = window?.contentView.children.find(
        (child) => 'webContents' in child && (child as Electron.WebContentsView).webContents.getURL() === pageUrl,
      ) as Electron.WebContentsView | undefined;
      if (!view) return null;
      return { id: view.webContents.id, visible: view.getVisible(), bounds: view.getBounds() };
    },
    url,
  );
}

test('moving away from the canvas and back keeps it exactly where it was (scroll, selection, chat draft)', async () => {
  const canvasA = `${fake.origin}/design/p/canvas-a`;
  const canvasB = `${fake.origin}/design/p/canvas-b`;

  const opened = await invoke('design:open', { ticketId: '71273', url: canvasA, bounds: BOUNDS });
  expect(opened).toMatchObject({ ok: true, data: { ticketId: '71273', visible: true } });
  await expect.poll(async () => (await viewState('71273'))?.status).toBe('signed-in');
  expect(await viewState('71273')).toMatchObject({ url: canvasA, visible: true });

  const before = await nativeView(canvasA);
  expect(before).toMatchObject({ visible: true, bounds: BOUNDS });

  // The user types into the canvas chat, selects part of the draft and scrolls the canvas.
  await app.evaluate(({ webContents }, pageUrl) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === pageUrl);
    if (!contents) throw new Error('no canvas view');
    contents.focus();
  }, canvasA);
  await inView(canvasA, "document.getElementById('draft').focus(); true");
  await app.evaluate(async ({ webContents }, pageUrl) => {
    await webContents.getAllWebContents().find((candidate) => candidate.getURL() === pageUrl)?.insertText('Make the header sticky');
  }, canvasA);
  await inView(canvasA, "document.getElementById('draft').setSelectionRange(5, 15, 'forward'); window.scrollTo(0, 1200); true");
  expect(await inView<number>(canvasA, 'window.scrollY')).toBe(1200);
  const loadId = await inView<string>(canvasA, 'window.loadId');

  // The user goes to Output: the placeholder unmounts and the view is hidden.
  expect(await invoke('design:hide', { ticketId: '71273' })).toEqual({ ok: true, data: { found: true } });
  expect(await viewState('71273')).toMatchObject({ visible: false });
  expect(await nativeView(canvasA)).toMatchObject({ id: before?.id, visible: false });

  // Meanwhile another ticket's canvas is opened and left.
  await invoke('design:open', { ticketId: '71274', url: canvasB, bounds: BOUNDS });
  await expect.poll(async () => (await viewState('71274'))?.status).toBe('signed-in');
  await invoke('design:hide', { ticketId: '71274' });

  // Back on Claude Design: the same page, not reloaded, exactly as it was left.
  const back = await invoke('design:open', { ticketId: '71273', url: canvasA, bounds: BOUNDS });
  expect(back).toMatchObject({ ok: true, data: { status: 'signed-in', url: canvasA, visible: true } });
  expect(await nativeView(canvasA)).toEqual({ id: before?.id, visible: true, bounds: BOUNDS });
  expect(await nativeView(canvasB)).toMatchObject({ visible: false });

  const after = await inView<Record<string, unknown>>(
    canvasA,
    `(() => {
      const draft = document.getElementById('draft');
      return {
        loadId: window.loadId,
        loads: sessionStorage.loads,
        scrollY: window.scrollY,
        draft: draft.value,
        selection: [draft.selectionStart, draft.selectionEnd],
        focused: document.activeElement && document.activeElement.id,
      };
    })()`,
  );
  expect(after).toEqual({ loadId, loads: '1', scrollY: 1200, draft: 'Make the header sticky', selection: [5, 15], focused: 'draft' });
});

test('the placeholder bounds move the view', async () => {
  const canvasA = `${fake.origin}/design/p/canvas-a`;
  const moved = { x: 64, y: 200, width: 640, height: 400 };
  expect(await invoke('design:setBounds', { ticketId: '71273', bounds: moved })).toEqual({ ok: true, data: { found: true } });
  expect((await nativeView(canvasA))?.bounds).toEqual(moved);
});

test('a redirect to the claude.ai sign-in page reports the view as signed out', async () => {
  const opened = await invoke('design:open', { ticketId: 'signed-out', url: `${fake.origin}/design/p/signed-out`, bounds: BOUNDS });
  expect(opened.ok).toBe(true);
  // The sign-in page's query (which can carry tokens) is not reported.
  await expect.poll(() => viewState('signed-out')).toMatchObject({ status: 'signed-out', url: `${fake.origin}/login` });
  await invoke('design:close', { ticketId: 'signed-out' });
});

test('refuses to open anything but claude.ai in the view', async () => {
  for (const url of ['https://example.com/', `${fake.origin.replace(/:\d+$/, ':1')}/design/p/x`, 'file:///C:/Windows/win.ini']) {
    expect(await invoke('design:open', { ticketId: 'evil', url }), url).toMatchObject({ ok: false, code: 'VALIDATION' });
  }
  expect(await viewState('evil')).toBeNull();
});

test('the design view cannot call any app channel', async () => {
  const probeUrl = `${fake.origin}/design/p/probe`;
  await invoke('design:open', { ticketId: 'probe', url: probeUrl, bounds: BOUNDS });
  await expect.poll(async () => (await viewState('probe'))?.status).toBe('signed-in');

  // No bridge, no Node, no Electron in the page.
  const globals = await inView<Record<string, string>>(
    probeUrl,
    "({ bridge: typeof window.agentLanes, require: typeof window.require, process: typeof window.process, electron: typeof window.electron, ipcRenderer: typeof window.ipcRenderer })",
  );
  expect(globals).toEqual({ bridge: 'undefined', require: 'undefined', process: 'undefined', electron: 'undefined', ipcRenderer: 'undefined' });

  // The view runs with no preload, sandboxed and context-isolated, in the claude-design partition.
  const preferences = await app.evaluate(({ session, webContents }, pageUrl) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === pageUrl);
    if (!contents) return null;
    // Not in Electron's typings, but present at runtime.
    const prefs = (contents as unknown as { getLastWebPreferences(): Electron.WebPreferences | null }).getLastWebPreferences();
    return {
      preload: prefs?.preload || null,
      sandbox: prefs?.sandbox,
      contextIsolation: prefs?.contextIsolation,
      nodeIntegration: prefs?.nodeIntegration,
      designPartition: contents.session === session.fromPartition('persist:claude-design'),
      appSession: contents.session === session.defaultSession,
    };
  }, probeUrl);
  expect(preferences).toEqual({ preload: null, sandbox: true, contextIsolation: true, nodeIntegration: false, designPartition: true, appSession: false });

  // Even a forged invoke carrying the view's frame as sender is refused on every app channel by the
  // handlers main registered (AL-011 trusted-sender check), while the renderer's own frame is served.
  const replies = await app.evaluate(
    async ({ BrowserWindow, ipcMain, webContents }, [pageUrl, channels]) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === pageUrl);
      // Electron keeps ipcMain.handle handlers here; calling one runs the app's registered handler.
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, payload: unknown) => Promise<{ ok: boolean; code?: string }>> })
        ._invokeHandlers;
      const fromView: Record<string, string | undefined> = {};
      for (const channel of channels) {
        const handler = handlers.get(channel);
        if (!handler) {
          fromView[channel] = 'no handler';
          continue;
        }
        const reply = await handler({ sender: contents, senderFrame: contents?.mainFrame }, undefined);
        fromView[channel] = reply.ok ? 'served' : reply.code;
      }
      const renderer = BrowserWindow.getAllWindows()[0]?.webContents;
      const control = await handlers.get('app:getInfo')?.({ sender: renderer, senderFrame: renderer?.mainFrame }, undefined);
      return { fromView, control: control?.ok };
    },
    [probeUrl, [...INVOKE_CHANNEL_NAMES]] as const,
  );
  expect(replies.control).toBe(true);
  expect(Object.keys(replies.fromView)).toEqual([...INVOKE_CHANNEL_NAMES]);
  for (const [channel, outcome] of Object.entries(replies.fromView)) {
    expect(outcome, channel).toBe('VALIDATION');
  }

  // The view cannot turn into the app renderer or wander off claude.ai.
  const rendererUrl = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getURL() ?? '');
  await inView(probeUrl, `location.href = ${JSON.stringify(rendererUrl)}; true`);
  await inView(probeUrl, `location.href = ${JSON.stringify(fake.origin.replace(/:\d+$/, ':1') + '/')}; true`);
  await page.waitForTimeout(500);
  expect(await nativeView(probeUrl)).not.toBeNull();
  // Stopped before loading, not attempted and failed.
  expect(await viewState('probe')).toMatchObject({ status: 'signed-in', url: probeUrl });

  // A popup off the allow-list goes to the OS browser, never into an app window.
  const windowsBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  await inView(probeUrl, "window.open('https://example.com/docs'); true");
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { openedExternally: string[] }).openedExternally)).toEqual([
    'https://example.com/docs',
  ]);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(windowsBefore);
});

test('hiding never destroys a view; only the live-view limit or close does', async () => {
  // Views so far: 71273, 71274, probe (signed-out was closed). A fourth evicts the least recent, 71274.
  await invoke('design:open', { ticketId: '71275', url: `${fake.origin}/design/p/canvas-b`, bounds: BOUNDS });
  expect(await viewState('71274')).toBeNull();
  expect(await viewState('71273')).not.toBeNull();
  expect(await viewState('probe')).not.toBeNull();

  expect(await invoke('design:close', { ticketId: '71275' })).toEqual({ ok: true, data: { found: true } });
  expect(await viewState('71275')).toBeNull();
});
