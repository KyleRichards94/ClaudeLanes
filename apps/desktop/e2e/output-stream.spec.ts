import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { e2eTicketRecord, seedTicketRecords } from './support/ticket-records';

/**
 * AL-175: the drill-in's Output tab in the real app. Output events are sent the way main's `emit`
 * sends `agent:output` (to the window's top frame), so they pass the preload's contract check, the
 * event hub's per-frame batching and the output store before the stream draws them. No session runs.
 */

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-output-'));
  seedTicketRecords(userDataDir, [e2eTicketRecord()]);
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
  });
  page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 960));
  await page.evaluate(() => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = '#/ticket/71273';
  });
  await expect(page.getByTestId('ticket-tab-output')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

/** Sends `count` output events from main, starting after `from`: artboard 3's rows, repeated. */
async function streamFromMain(from: number, count: number) {
  await app.evaluate(
    ({ BrowserWindow }, [start, total]) => {
      const frame = BrowserWindow.getAllWindows()[0]?.webContents.mainFrame;
      const lead = { parentToolUseId: null };
      for (let seq = start + 1; seq <= start + total; seq++) {
        const at = Date.now();
        let item: unknown;
        switch (seq % 4) {
          case 0:
            item = { kind: 'system', text: `Step ${seq} · moved to Implementing`, ...lead };
            break;
          case 1:
            item = { kind: 'tool', rowId: `row_${seq}`, toolUseIds: [`row_${seq}`], tool: 'edit', label: 'Edit', detail: `Pages/Jobs/JobControl${seq}.razor`, stats: '+214 −0', ...lead };
            break;
          case 2:
            item = { kind: 'text', streamId: `msg_${seq}`, text: `Output line ${seq}: cutting over **frmJobFilter** with the parent and keeping the other modals as WinForms.`, ...lead };
            break;
          default:
            item = { kind: 'tool', rowId: `row_${seq}`, toolUseIds: [`row_${seq}`], tool: 'bash', label: 'Bash', detail: 'dotnet build OnSite.Blazor.csproj', stats: '0 errors · 2 warnings', ...lead };
        }
        frame?.send('agent:output', { ticketId: '71273', at, seq, item });
      }
    },
    [from, count] as const,
  );
}

test('streams output into the Output tab and follows the newest line', async () => {
  await streamFromMain(0, 3);
  await expect(page.getByText('Pages/Jobs/JobControl1.razor')).toBeVisible();
  await expect(page.getByTestId('output-tool').first()).toContainText('Edit');
  await expect(page.getByText('frmJobFilter').first()).toBeVisible();

  await app.evaluate(({ BrowserWindow }) => {
    const frame = BrowserWindow.getAllWindows()[0]?.webContents.mainFrame;
    frame?.send('agent:output', { ticketId: '71273', at: Date.now(), seq: 4, item: { kind: 'text-delta', streamId: 'live', text: 'Wiring the job grid filters', parentToolUseId: null } });
  });
  await expect(page.getByTestId('output-streaming')).toHaveText('Wiring the job grid filters▍');
});

test('keeps scrolling smoothly through 10,000 events, drawing only the rows in view', async () => {
  await streamFromMain(4, 10_000);
  await expect(page.getByText('Output line 10002:', { exact: false })).toBeVisible({ timeout: 30_000 });

  const drawn = await page.getByTestId('ticket-tab-output-scroll').locator('[data-testid^="output-"]').count();
  expect(drawn).toBeLessThan(150);

  // Scroll up through the stream one step per frame and time the frames.
  const timing = await page.evaluate(async () => {
    interface Scroller {
      scrollTop: number;
      dispatchEvent(event: unknown): boolean;
      querySelectorAll(selector: string): { length: number };
    }
    const dom = globalThis as unknown as {
      document: { querySelector(selector: string): Scroller };
      requestAnimationFrame(callback: () => void): number;
      Event: new (type: string) => unknown;
    };
    const scroller = dom.document.querySelector('[data-testid="ticket-tab-output-scroll"]');
    const frames: number[] = [];
    let last = performance.now();
    for (let step = 0; step < 180; step++) {
      scroller.scrollTop = Math.max(scroller.scrollTop - 400, 0);
      scroller.dispatchEvent(new dom.Event('scroll'));
      await new Promise<void>((resolve) => dom.requestAnimationFrame(() => resolve()));
      const now = performance.now();
      frames.push(now - last);
      last = now;
    }
    frames.sort((a, b) => a - b);
    return { median: frames[Math.floor(frames.length / 2)]!, p90: frames[Math.floor(frames.length * 0.9)]!, rows: scroller.querySelectorAll('[data-testid^="output-"]').length };
  });
  console.log(`Output stream scroll: median frame ${timing.median.toFixed(1)} ms, p90 ${timing.p90.toFixed(1)} ms, ${timing.rows} rows drawn`);
  // 60 fps is 16.7 ms a frame; the bound leaves room for a loaded CI machine.
  expect(timing.median).toBeLessThan(25);
  expect(timing.rows).toBeLessThan(150);

  await expect(page.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
  await page.getByRole('button', { name: 'Jump to latest' }).click();
  await expect(page.getByText('Output line 10002:', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Jump to latest' })).toHaveCount(0);
});
