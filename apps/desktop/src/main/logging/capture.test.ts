import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureConsole, captureProcessErrors, type ProcessLike } from './capture';
import { createLogger, type ConsoleLike } from './logger';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-lanes-capture-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakeConsole() {
  const printed: Array<[string, unknown[]]> = [];
  const target: ConsoleLike = {
    debug: (...args) => printed.push(['debug', args]),
    info: (...args) => printed.push(['info', args]),
    warn: (...args) => printed.push(['warn', args]),
    error: (...args) => printed.push(['error', args]),
  };
  return { target, printed };
}

describe('captureConsole', () => {
  it('copies console.warn and console.error into the log, redacted, and still prints them', async () => {
    const { target, printed } = fakeConsole();
    const log = createLogger({ directory: dir, env: {} });
    log.redactor.addSecret('console-secret-123');
    const restore = captureConsole(log, target);

    target.warn('[secrets] could not read secrets.json');
    target.error('Request failed for console-secret-123', new Error('boom'));
    target.info('not captured');

    const text = await readFile(log.filePath, 'utf8');
    expect(text).toContain('WARN  [console] [secrets] could not read secrets.json\n');
    expect(text).toContain('ERROR [console] Request failed for [REDACTED]\n  Error: boom\n');
    expect(text).not.toContain('not captured');
    expect(printed.map(([level]) => level)).toEqual(['warn', 'error', 'info']);

    restore();
    target.error('after restore');
    expect(await readFile(log.filePath, 'utf8')).not.toContain('after restore');
  });

  it('does not log a mirrored line twice', async () => {
    const { target, printed } = fakeConsole();
    const log = createLogger({ directory: dir, env: {}, mirror: target });
    captureConsole(log, target);

    log.error('once');

    const text = await readFile(log.filePath, 'utf8');
    expect(text.match(/once/g)).toHaveLength(1);
    expect(printed).toHaveLength(1);
  });
});

describe('captureProcessErrors', () => {
  it('logs uncaught exceptions and unhandled rejections with their stack', async () => {
    const fakeProcess = new EventEmitter();
    const log = createLogger({ directory: dir, env: {} });
    const restore = captureProcessErrors(log, fakeProcess as unknown as ProcessLike);

    fakeProcess.emit('uncaughtExceptionMonitor', new Error('kaboom'), 'uncaughtException');
    fakeProcess.emit('unhandledRejection', new Error('forgot to await'));
    fakeProcess.emit('unhandledRejection', 'a plain string reason');

    const text = await readFile(log.filePath, 'utf8');
    expect(text).toContain('ERROR [process] Uncaught exception\n  Error: kaboom\n');
    expect(text).toContain('ERROR [process] Unhandled promise rejection\n  Error: forgot to await\n');
    expect(text).toContain('ERROR [process] Unhandled promise rejection a plain string reason\n');

    restore();
    expect(fakeProcess.listenerCount('uncaughtExceptionMonitor')).toBe(0);
    expect(fakeProcess.listenerCount('unhandledRejection')).toBe(0);
  });
});
