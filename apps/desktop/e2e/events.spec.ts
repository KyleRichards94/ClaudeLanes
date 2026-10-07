import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

/** What the renderer test code below keeps on `window`. */
interface Probe {
  agentLanes: { on(channel: string, listener: (payload: unknown) => void): () => void };
  received: { first: unknown[]; second: unknown[] };
  unsubscribeFirst: () => void;
}

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
  await expect(page.getByText('Agent board')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

/** Sends an event to the main window's top frame, the way main's `emit` delivers it. */
async function sendFromMain(channel: string, payload: unknown) {
  await app.evaluate(
    ({ BrowserWindow }, [eventChannel, eventPayload]) => {
      BrowserWindow.getAllWindows()[0]?.webContents.mainFrame.send(eventChannel as string, eventPayload);
    },
    [channel, payload] as const,
  );
}

function received(): Promise<Probe['received']> {
  return page.evaluate(() => (globalThis as unknown as Probe).received);
}

test('delivers main → renderer events through the preload until the listener unsubscribes', async () => {
  await page.evaluate(() => {
    const probe = globalThis as unknown as Probe;
    probe.received = { first: [], second: [] };
    probe.unsubscribeFirst = probe.agentLanes.on('toast', (payload) => probe.received.first.push(payload));
    probe.agentLanes.on('toast', (payload) => probe.received.second.push(payload));
  });

  const saved = { at: 1, tone: 'info', title: 'Saved' };
  await sendFromMain('toast', saved);
  await expect.poll(async () => (await received()).second).toEqual([saved]);
  expect((await received()).first).toEqual([saved]);

  // The unsubscribe function comes back through contextBridge; calling it must detach the listener.
  await page.evaluate(() => (globalThis as unknown as Probe).unsubscribeFirst());

  const lost = { at: 2, tone: 'error', title: 'MCP bridge lost the session' };
  await sendFromMain('toast', lost);
  await expect.poll(async () => (await received()).second).toEqual([saved, lost]);
  expect((await received()).first).toEqual([saved]);
});

test('refuses to subscribe to a channel outside the contracts allow-list', async () => {
  const error = await page.evaluate(() => {
    try {
      (globalThis as unknown as Probe).agentLanes.on('ado:token', () => undefined);
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  });
  expect(error).toContain('Unknown event channel ado:token');
});
