import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleInvoke } from '../ipc/handle-invoke';
import { createLogger, type Logger } from '../logging';
import { createDiagnostics } from './diagnostics';
import { createDiagnosticsHandlers } from './handlers';

const clipboardText = vi.hoisted(() => ({ value: '' }));
vi.mock('electron', () => ({ clipboard: { writeText: (text: string) => (clipboardText.value = text) } }));

const appInfo = () => ({
  name: 'Agent Lanes',
  version: '0.1.0',
  platform: 'win32',
  versions: { electron: '44.6.0', chrome: '140.0.0.0', node: '24.9.0' },
});

let dir: string;
let log: Logger;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-lanes-diagnostics-handlers-'));
  log = createLogger({ directory: dir, env: {} });
  clipboardText.value = '';
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function handlers() {
  return createDiagnosticsHandlers({ log, diagnostics: createDiagnostics({ appInfo, log }) });
}

describe('diagnostics handlers', () => {
  it('app:logError writes the renderer error to the log and to recent errors', async () => {
    const result = await handleInvoke(
      'app:logError',
      {
        source: 'boundary',
        boundary: 'lane:Planning',
        name: 'TypeError',
        message: "Cannot read properties of undefined (reading 'title')",
        stack: 'TypeError: Cannot read properties of undefined\n    at AgentTicketCard (card.tsx:10:5)',
        componentStack: '\n    at AgentTicketCard\n    at Lane',
      },
      handlers()['app:logError'],
    );

    expect(result).toEqual({ ok: true, data: null });
    const text = await readFile(log.filePath, 'utf8');
    expect(text).toContain(`ERROR [renderer] Error boundary "lane:Planning" caught TypeError: Cannot read properties of undefined (reading 'title')\n`);
    expect(text).toContain('    at AgentTicketCard (card.tsx:10:5)\n  Component stack:\n      at AgentTicketCard\n      at Lane\n');
    expect(log.recentProblems()[0]?.scope).toBe('renderer');
  });

  it.each([
    [{ source: 'window', message: 'x is not defined', name: 'ReferenceError' }, 'Uncaught ReferenceError: x is not defined'],
    [{ source: 'promise', message: 'fetch failed' }, 'Unhandled rejection Error: fetch failed'],
  ] as const)('describes a %s error', async (report, expected) => {
    await handleInvoke('app:logError', report, handlers()['app:logError']);
    expect(await readFile(log.filePath, 'utf8')).toContain(`[renderer] ${expected}\n`);
  });

  it('app:logError refuses an oversized report instead of logging it', async () => {
    const result = await handleInvoke('app:logError', { source: 'window', message: 'x'.repeat(5_000) }, handlers()['app:logError']);
    expect(!result.ok && result.code).toBe('VALIDATION');
  });

  it('app:copyDiagnostics puts the report text on the clipboard', async () => {
    log.error('something broke');
    const result = await handleInvoke('app:copyDiagnostics', undefined, handlers()['app:copyDiagnostics']);

    expect(clipboardText.value).toContain('Agent Lanes diagnostics');
    expect(clipboardText.value).toContain('ERROR [main] something broke');
    expect(result).toEqual({ ok: true, data: { characters: clipboardText.value.length } });
  });

  it('app:getDiagnostics returns the report', async () => {
    const result = await handleInvoke('app:getDiagnostics', undefined, handlers()['app:getDiagnostics']);
    expect(result.ok && result.data.app.version).toBe('0.1.0');
    expect(result.ok && result.data.text).toContain('Versions');
  });
});
