import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

/**
 * AL-190 spike: the Electron behaviour the Claude Design view (AL-191) depends on, checked against a
 * local stand-in for claude.ai that sends the same kind of frame-blocking headers. claude.ai itself is
 * never contacted; whether the real site signs in inside the view is checked by hand (see AL-190).
 *
 * Findings this guards:
 * - a page that refuses to be framed still loads in a WebContentsView (a top-level page), while an
 *   iframe of it is blocked, so the design tab uses a WebContentsView, not an iframe or <webview>;
 * - a `persist:` partition keeps the canvas's cookies away from the app's own session and keeps them
 *   across restarts, so a claude.ai sign-in made in the view survives an app restart;
 * - a view created without a preload has no app bridge and no Node.
 */

const PARTITION = 'persist:claude-design';

const FRAME_BLOCKING_HEADERS = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
};

function startFakeClaude(): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const html = (status: number, body: string, headers: Record<string, string> = {}): void => {
      response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
      response.end(body);
    };

    switch (request.url) {
      case '/design/p/spike-canvas':
        return html(200, '<!doctype html><title>Fake canvas</title><p>canvas</p>', {
          ...FRAME_BLOCKING_HEADERS,
          // What a sign-in leaves behind: a persistent, HttpOnly session cookie.
          'Set-Cookie': 'spike_session=signed-in; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax',
        });
      case '/plain':
        return html(200, '<!doctype html><title>Plain page</title>');
      case '/host':
        return html(
          200,
          '<!doctype html><title>Host</title>' +
            '<iframe id="blocked" src="/design/p/spike-canvas"></iframe>' +
            '<iframe id="control" src="/plain"></iframe>',
        );
      default:
        return html(404, 'not found');
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

function launch(userDataDir: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
  });
}

test.describe('Claude Design embed mechanics (AL-190 spike)', () => {
  // The restart test reads the cookie the first test left in the partition.
  test.describe.configure({ mode: 'serial' });

  let app: ElectronApplication;
  let userDataDir: string;
  let fake: { server: Server; origin: string };

  test.beforeAll(async () => {
    fake = await startFakeClaude();
    userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-design-'));
    app = await launch(userDataDir);
    await app.firstWindow();
  });

  test.afterAll(async () => {
    await app?.close();
    await new Promise((resolve) => fake?.server.close(resolve));
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('a frame-blocking page loads in a WebContentsView with its own partition', async () => {
    const canvasUrl = `${fake.origin}/design/p/spike-canvas`;

    const result = await app.evaluate(
      async ({ BrowserWindow, WebContentsView, session }, { url, partition }) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (!window) throw new Error('no main window');

        const view = new WebContentsView({
          webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false },
        });
        window.contentView.addChildView(view);
        view.setBounds({ x: 0, y: 0, width: 480, height: 320 });
        try {
          await view.webContents.loadURL(url);
          const guest = (await view.webContents.executeJavaScript(
            '({ bridge: typeof window.agentLanes, require: typeof window.require, process: typeof window.process })',
          )) as Record<string, string>;
          const designSession = session.fromPartition(partition);
          const inPartition = await designSession.cookies.get({ url });
          const inAppSession = await session.defaultSession.cookies.get({ url });
          await designSession.cookies.flushStore();
          return {
            title: view.webContents.getTitle(),
            guest,
            partitionCookies: inPartition.map((cookie) => cookie.name),
            appSessionCookies: inAppSession.map((cookie) => cookie.name),
            persistent: designSession.isPersistent(),
            userAgent: view.webContents.getUserAgent(),
          };
        } finally {
          window.contentView.removeChildView(view);
          view.webContents.close();
        }
      },
      { url: canvasUrl, partition: PARTITION },
    );

    // Recorded for the sign-in question: Google blocks OAuth in user agents it sees as embedded.
    test.info().annotations.push({ type: 'design view user agent', description: result.userAgent });

    expect(result.title).toBe('Fake canvas');
    expect(result.guest).toEqual({ bridge: 'undefined', require: 'undefined', process: 'undefined' });
    expect(result.persistent).toBe(true);
    expect(result.partitionCookies).toEqual(['spike_session']);
    expect(result.appSessionCookies).toEqual([]);
  });

  test('the same page in an iframe is blocked by its frame headers', async () => {
    const result = await app.evaluate(
      async ({ BrowserWindow }, { url }) => {
        // A throwaway in-memory session, so nothing here touches the design partition.
        const probe = new BrowserWindow({ show: false, webPreferences: { partition: 'al190-iframe-probe', sandbox: true } });
        const failures: { code: number; description: string; url: string; isMainFrame: boolean }[] = [];
        probe.webContents.on('did-fail-load', (_event, code, description, failedUrl, isMainFrame) => {
          failures.push({ code, description, url: new URL(failedUrl).pathname, isMainFrame });
        });
        try {
          await probe.webContents.loadURL(url);
          // Same origin as the host, so a frame that loaded exposes its title; a blocked one is an opaque error page.
          const titles = (await probe.webContents.executeJavaScript(
            "Object.fromEntries([...document.querySelectorAll('iframe')].map((f) => [f.id, f.contentDocument ? f.contentDocument.title : null]))",
          )) as Record<string, string | null>;
          return { failures, titles };
        } finally {
          probe.destroy();
        }
      },
      { url: `${fake.origin}/host` },
    );

    expect(result.titles).toEqual({ blocked: null, control: 'Plain page' });
    expect(result.failures).toEqual([
      { code: -27, description: 'ERR_BLOCKED_BY_RESPONSE', url: '/design/p/spike-canvas', isMainFrame: false },
    ]);
  });

  test('the sign-in cookie in the persistent partition survives an app restart', async () => {
    await app.close();
    app = await launch(userDataDir);
    await app.firstWindow();

    const names = await app.evaluate(
      async ({ session }, { url, partition }) => (await session.fromPartition(partition).cookies.get({ url })).map((c) => c.name),
      { url: `${fake.origin}/design/p/spike-canvas`, partition: PARTITION },
    );

    expect(names).toEqual(['spike_session']);
  });
});
