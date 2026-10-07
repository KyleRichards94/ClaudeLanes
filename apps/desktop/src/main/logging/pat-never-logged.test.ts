import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiagnostics } from '../diagnostics';
import { createDiagnosticsHandlers } from '../diagnostics/handlers';
import { handleInvoke } from '../ipc/handle-invoke';
import { SECRETS_FILE_NAME, createSecretStore } from '../secrets';
import { createFakeSafeStorage } from '../secrets/testing';
import { captureConsole, captureProcessErrors, type ProcessLike } from './capture';
import { createLogger, type ConsoleLike, type Logger } from './logger';

// The diagnostics handlers import Electron's clipboard; these tests pass their own.
vi.mock('electron', () => ({ clipboard: { writeText: () => undefined } }));

/**
 * AL-214 acceptance: "A test seeds a PAT and asserts it never appears in the log file."
 *
 * The PAT is seeded the way the app gets one: saved through the SecretStore (as Connections will)
 * and read back by a service. It then reaches the log every way a service, a library, the renderer
 * or a crash could put it there, enough times to rotate the file, and every log file is searched
 * for the PAT and for the encodings it travels in.
 */

/** Shaped like an ADO PAT (52 characters); made up for the test, never a real credential. */
const PAT = 'fakepat0000test1111only2222never3333real4444abcd7Fq2';
const PAT_FORMS = {
  plain: PAT,
  base64: Buffer.from(PAT).toString('base64'),
  basicAuth: Buffer.from(`:${PAT}`).toString('base64'),
  base64url: Buffer.from(PAT).toString('base64url'),
  urlEncoded: encodeURIComponent(PAT),
};

let dir: string;
let logDir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-lanes-pat-'));
  logDir = join(dir, 'logs');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function silentConsole(): ConsoleLike {
  return { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };
}

async function readAllLogs(): Promise<{ files: string[]; text: string }> {
  const files = (await readdir(logDir)).sort();
  const texts = await Promise.all(files.map((name) => readFile(join(logDir, name), 'utf8')));
  return { files, text: texts.join('\n') };
}

function expectNoPat(text: string): void {
  for (const [form, value] of Object.entries(PAT_FORMS)) {
    expect(text.includes(value), `log contains the PAT (${form})`).toBe(false);
  }
}

/** The ways a PAT can reach the log, each through a real code path. */
async function logThePatEveryWay(log: Logger, pat: string, console: ConsoleLike, fakeProcess: EventEmitter) {
  const ado = log.child('ado');
  // A message built with the token in it.
  ado.info(`GET https://dev.azure.com/contoso/_apis/connectionData with PAT ${pat}`);
  // An error whose message, cause and fields carry it.
  ado.error(
    'Request failed',
    Object.assign(new Error(`401 Unauthorized for ${pat}`, { cause: new Error(`token ${pat} expired`) }), {
      config: { headers: { Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}` } },
    }),
  );
  // Request details with auth headers, a credentialed URL and a query string.
  ado.warn('Retrying', {
    url: `https://kyle:${pat}@dev.azure.com/contoso/_git/app`,
    query: `?api-version=7.1&token=${pat}`,
    headers: { authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`, accept: 'application/json' },
  });
  // A child process started with the PAT in its environment.
  log.child('git').debug('spawn git fetch', { command: 'git', args: ['fetch'], env: { AZURE_DEVOPS_EXT_PAT: pat, PATH: 'C:\\bin' } });
  log.child('git').error(`git fetch failed: fatal: could not read from https://${pat}@dev.azure.com/contoso/_git/app`);
  // A settings-like object that should never have held it.
  log.child('settings').info('Loaded', { org: 'contoso', pat, nested: [{ token: pat }] });
  // A library writing to the console.
  console.error('Unexpected response', pat, { password: pat });
  console.warn(`Header was "Authorization: Bearer ${pat}"`);
  // A crash and a forgotten await.
  fakeProcess.emit('uncaughtExceptionMonitor', new Error(`crashed holding ${pat}`), 'uncaughtException');
  fakeProcess.emit('unhandledRejection', new Error(`rejected with ${pat}`));
  // The renderer reporting an error that quotes it (app:logError, through IPC validation).
  const handlers = createDiagnosticsHandlers({ log, diagnostics: createDiagnostics({ appInfo, log }) }, () => undefined);
  const logged = await handleInvoke(
    'app:logError',
    { source: 'boundary', boundary: 'app', name: 'Error', message: `Render failed: ${pat}`, stack: `Error: ${pat}\n    at Card (card.tsx:1:1)` },
    handlers['app:logError'],
  );
  expect(logged.ok).toBe(true);
  // A handler that throws with it (handleInvoke logs the throw).
  await handleInvoke('app:getInfo', undefined, () => {
    throw new Error(`handler leaked ${pat}`);
  }, log.child('ipc'));
}

const appInfo = () => ({
  name: 'Agent Lanes',
  version: '0.1.0',
  platform: 'win32',
  versions: { electron: '44.6.0', chrome: '140.0.0.0', node: '24.9.0' },
});

describe('AL-214: a PAT never appears in the log file', () => {
  it('seeds a PAT through the secret store and finds it in no log file, rotated ones included', async () => {
    const console = silentConsole();
    const fakeProcess = new EventEmitter();
    // Small files, so the run rotates and the rotated copies are checked too.
    const log = createLogger({ directory: logDir, env: {}, level: 'debug', maxBytes: 4 * 1024, maxFiles: 4 });
    captureConsole(log, console);
    captureProcessErrors(log, fakeProcess as unknown as ProcessLike);

    // Wired as services.ts wires them.
    const secrets = createSecretStore({
      filePath: join(dir, SECRETS_FILE_NAME),
      safeStorage: createFakeSafeStorage(),
      warn: (message) => log.child('secrets').warn(message),
      onPlaintext: (secret) => log.redactor.addSecret(secret),
    });
    await secrets.put('ado:contoso', PAT);
    const pat = await secrets.get('ado:contoso');
    expect(pat).toBe(PAT);

    await logThePatEveryWay(log, PAT, console, fakeProcess);
    for (let n = 0; n < 40; n += 1) log.child('ado').info(`poll ${n} with ${PAT}`);

    const { files, text } = await readAllLogs();
    expect(files.length).toBeGreaterThan(1);
    expect(text).toContain('[REDACTED]');
    expect(text).toContain('Render failed: [REDACTED]');
    expect(text).toContain('handler leaked [REDACTED]');
    expectNoPat(text);

    // Diagnostics are built from the same log: the PAT is not in them either.
    const report = await createDiagnostics({ appInfo, log, secrets }).collect();
    expectNoPat(JSON.stringify(report));
    expect(report.secureStorage).toEqual({ encryptionAvailable: true, savedEntries: 1, issues: [] });
  });

  it('keeps out a PAT from a previous run once a service reads it', async () => {
    const safeStorage = createFakeSafeStorage();
    const filePath = join(dir, SECRETS_FILE_NAME);
    await createSecretStore({ filePath, safeStorage, warn: () => undefined }).put('ado:contoso', PAT);

    // Next start: a fresh log knows nothing until the store decrypts the PAT for a service.
    const log = createLogger({ directory: logDir, env: {} });
    const secrets = createSecretStore({ filePath, safeStorage, onPlaintext: (secret) => log.redactor.addSecret(secret) });
    const pat = await secrets.get('ado:contoso');
    log.error(`ADO said 401 for ${pat}`);

    const { text } = await readAllLogs();
    expect(text).toContain('ADO said 401 for [REDACTED]');
    expectNoPat(text);
  });

  it('keeps out a PAT nobody registered: one from the environment, and one known only by its shape', async () => {
    const classicPat = 'abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrst';
    const log = createLogger({ directory: logDir, env: { AZURE_DEVOPS_EXT_PAT: PAT } });

    log.error(`env PAT ${PAT}; pasted PAT ${classicPat}`);

    const { text } = await readAllLogs();
    expectNoPat(text);
    expect(text).not.toContain(classicPat);
    expect(text).toContain('env PAT [REDACTED]; pasted PAT [REDACTED]');
  });
});
