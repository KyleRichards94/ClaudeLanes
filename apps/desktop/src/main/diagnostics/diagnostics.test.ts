import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiagnosticsReportSchema } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger, type Logger } from '../logging';
import type { SecretStoreStatus } from '../secrets';
import { createDiagnostics, readJsonFile, tildify } from './diagnostics';

const appInfo = () => ({
  name: 'Agent Lanes',
  version: '0.1.0',
  platform: 'win32',
  versions: { electron: '44.6.0', chrome: '140.0.0.0', node: '24.9.0' },
});

let dir: string;
let log: Logger;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-lanes-diagnostics-'));
  log = createLogger({ directory: join(dir, 'logs'), env: {}, now: () => new Date('2026-10-07T03:04:05.000Z') });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakeSecrets(status: SecretStoreStatus, count: number) {
  return {
    status: async () => status,
    list: async () => Array.from({ length: count }, (_, index) => ({ id: `ado:org${index}`, createdAt: '', updatedAt: '' })),
  };
}

describe('createDiagnostics', () => {
  it('reports versions, settings without secrets and recent errors, as data and as text', async () => {
    log.redactor.addSecret('fake-mcp-token-0000');
    log.info('started');
    log.child('ipc').error('ado:listSprints failed: boom', new Error('boom'));
    log.child('secrets').warn('Secret ado:old could not be decrypted on this machine');

    const diagnostics = createDiagnostics({
      appInfo,
      log,
      secrets: fakeSecrets({ encryptionAvailable: true, issues: [{ kind: 'entry-undecryptable', id: 'ado:old' }] }, 2),
      settings: () => ({
        version: 2,
        repos: [{ path: 'C:\\repos\\app', buildCommand: 'dotnet build' }],
        mcp: [{ name: 'github', url: 'https://api.github.com', token: 'fake-mcp-token-0000', env: { GITHUB_TOKEN: 'fake-mcp-token-0000' } }],
        note: 'uses fake-mcp-token-0000',
      }),
      os: { release: '10.0.26200', arch: 'x64' },
      homeDirectory: 'C:\\Users\\someone',
      now: () => new Date('2026-10-07T03:04:05.000Z'),
    });

    const report = await diagnostics.collect();
    expect(DiagnosticsReportSchema.safeParse(report).success).toBe(true);
    expect(report.app.version).toBe('0.1.0');
    expect(report.settings).toEqual({
      version: 2,
      repos: [{ path: 'C:\\repos\\app', buildCommand: 'dotnet build' }],
      mcp: [{ name: 'github', url: 'https://api.github.com', token: '[REDACTED]', env: { GITHUB_TOKEN: '[REDACTED]' } }],
      note: 'uses [REDACTED]',
    });
    expect(report.secureStorage).toEqual({ encryptionAvailable: true, savedEntries: 2, issues: ['ado:old: cannot be decrypted on this machine'] });
    expect(report.recentErrors.map((problem) => `${problem.level} ${problem.scope} ${problem.message}`)).toEqual([
      'error ipc ado:listSprints failed: boom',
      'warn secrets Secret ado:old could not be decrypted on this machine',
    ]);

    expect(report.text).not.toContain('fake-mcp-token-0000');
    expect(report.text).toContain('Agent Lanes diagnostics\nGenerated 2026-10-07T03:04:05.000Z\n');
    expect(report.text).toContain('  Agent Lanes 0.1.0\n  Electron 44.6.0 · Chrome 140.0.0.0 · Node 24.9.0\n  win32 10.0.26200 (x64)\n');
    expect(report.text).toContain('Saved tokens: 2');
    expect(report.text).toContain('"token": "[REDACTED]"');
    expect(report.text).toContain('Recent errors (2, newest last)\n  2026-10-07T03:04:05.000Z ERROR [ipc] ado:listSprints failed: boom\n    Error: boom\n');
  });

  it('works with nothing saved yet', async () => {
    const report = await createDiagnostics({ appInfo, log, settings: () => null }).collect();
    expect(report.settings).toBeNull();
    expect(report.secureStorage).toBeNull();
    expect(report.recentErrors).toEqual([]);
    expect(report.text).toContain('Settings\n  None saved yet\n');
    expect(report.text).toContain('Secure storage\n  Not available\n');
    expect(report.text).toContain('Recent errors (none)\n');
  });

  it('still reports when the settings cannot be read', async () => {
    const report = await createDiagnostics({
      appInfo,
      log,
      settings: () => {
        throw new Error('settings exploded');
      },
    }).collect();
    expect(report.settings).toEqual({ unreadable: 'settings exploded' });
  });

  it('shows the log folder under ~', async () => {
    const report = await createDiagnostics({ appInfo, log, homeDirectory: dir }).collect();
    expect(report.logDirectory).toBe(`~${join(dir, 'logs').slice(dir.length)}`);
  });
});

describe('readJsonFile', () => {
  it('reads JSON, returns null when missing and says why when unreadable', async () => {
    const path = join(dir, 'settings.json');
    await expect(readJsonFile(path)).resolves.toBeNull();
    await writeFile(path, '{"version":2}');
    await expect(readJsonFile(path)).resolves.toEqual({ version: 2 });
    await writeFile(path, '{"version":');
    await expect(readJsonFile(path)).resolves.toEqual({ unreadable: 'not valid JSON' });
  });
});

describe('tildify', () => {
  it.each([
    ['C:\\Users\\someone\\AppData\\Roaming\\Agent Lanes\\logs', 'C:\\Users\\someone', '~\\AppData\\Roaming\\Agent Lanes\\logs'],
    ['c:\\users\\SOMEONE\\logs', 'C:\\Users\\someone', '~\\logs'],
    ['C:\\Users\\someone-else\\logs', 'C:\\Users\\someone', 'C:\\Users\\someone-else\\logs'],
    ['/home/someone/.config/Agent Lanes/logs', '/home/someone', '~/.config/Agent Lanes/logs'],
    ['/var/log', '/home/someone', '/var/log'],
  ])('%s', (path, home, expected) => {
    expect(tildify(path, home)).toBe(expected);
  });
});
