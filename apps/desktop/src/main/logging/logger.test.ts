import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger, type ConsoleLike, type LoggerOptions } from './logger';

let dir: string;
let tick: number;

const now = () => new Date(Date.UTC(2026, 9, 7, 1, 2, 3, tick++));

function openLog(overrides: Partial<LoggerOptions> = {}) {
  return createLogger({ directory: dir, env: {}, now, ...overrides });
}

async function logText(): Promise<string> {
  return readFile(join(dir, 'main.log'), 'utf8');
}

function recordingConsole(): ConsoleLike & { lines: Array<[string, unknown[]]> } {
  const lines: Array<[string, unknown[]]> = [];
  return {
    lines,
    debug: (...args) => lines.push(['debug', args]),
    info: (...args) => lines.push(['info', args]),
    warn: (...args) => lines.push(['warn', args]),
    error: (...args) => lines.push(['error', args]),
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-lanes-logger-'));
  tick = 0;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createLogger', () => {
  it('writes timestamped, levelled, scoped lines to <directory>/main.log', async () => {
    const log = openLog();
    log.info('Agent Lanes starting');
    log.child('ipc').warn('Refused app:getInfo from an untrusted frame');

    expect(log.filePath).toBe(join(dir, 'main.log'));
    expect(await logText()).toBe(
      '2026-10-07T01:02:03.000Z INFO  [main] Agent Lanes starting\n' +
        '2026-10-07T01:02:03.001Z WARN  [ipc] Refused app:getInfo from an untrusted frame\n',
    );
  });

  it('skips levels below the minimum', async () => {
    const log = openLog({ level: 'warn' });
    log.debug('debug line');
    log.info('info line');
    log.error('error line');
    expect(await logText()).toBe('2026-10-07T01:02:03.000Z ERROR [main] error line\n');
  });

  it('puts short details on the line and long ones indented below it', async () => {
    const log = openLog();
    log.info('spawned', { command: 'git', args: ['status'] });
    const error = new Error('outer', { cause: Object.assign(new Error('inner'), { code: 'ENOENT' }) });
    log.error('Build failed', error);

    const text = await logText();
    expect(text).toContain('INFO  [main] spawned {"command":"git","args":["status"]}\n');
    expect(text).toContain('ERROR [main] Build failed\n  Error: outer\n      at ');
    expect(text).toMatch(/\n {2}Caused by: Error: inner\n/);
    expect(text).toContain('  {"code":"ENOENT"}');
  });

  it('mirrors the redacted line to the console when asked, children included', () => {
    const output = recordingConsole();
    const log = openLog({ mirror: output });
    log.redactor.addSecret('super-secret-value');
    log.error('failed with super-secret-value');
    log.child('quiet', { mirror: false }).warn('not mirrored');
    log.child('loud').info('mirrored');

    expect(output.lines).toEqual([
      ['error', ['2026-10-07T01:02:03.000Z ERROR [main] failed with [REDACTED]']],
      ['info', ['2026-10-07T01:02:03.002Z INFO  [loud] mirrored']],
    ]);
  });

  it('keeps the latest warnings and errors, redacted, for diagnostics', () => {
    const log = openLog({ recentLimit: 2 });
    log.redactor.addSecret('another-secret-1');
    log.info('not a problem');
    log.warn('first');
    log.child('secrets').error('second has another-secret-1', new Error('boom'));
    log.error('third', { token: 'abc' });

    const recent = log.recentProblems();
    expect(recent.map((problem) => [problem.level, problem.scope, problem.message])).toEqual([
      ['error', 'secrets', 'second has [REDACTED]'],
      ['error', 'main', 'third'],
    ]);
    expect(recent[0]?.detail).toMatch(/^Error: boom\n {4}at /);
    expect(recent[1]?.detail).toBe('{"token":"[REDACTED]"}');
    // A copy: callers can't change the logger's history.
    recent.pop();
    expect(log.recentProblems()).toHaveLength(2);
  });

  it('indents the rest of a multi-line message, so it cannot pass for another entry', async () => {
    const log = openLog();
    log.error('first\n2026-01-01T00:00:00.000Z INFO  [main] forged');
    expect(await logText()).toBe('2026-10-07T01:02:03.000Z ERROR [main] first\n  2026-01-01T00:00:00.000Z INFO  [main] forged\n');
  });

  it('truncates a huge message', async () => {
    const log = openLog();
    log.info('x'.repeat(20_000));
    const text = await logText();
    expect(text.length).toBeLessThan(9_000);
    expect(text).toContain('… (12000 more characters)');
  });

  it('never throws, even when the log folder cannot be written', async () => {
    const output = recordingConsole();
    await writeFile(join(dir, 'blocked'), 'a file, not a folder');
    const log = createLogger({ directory: join(dir, 'blocked'), env: {}, mirror: output });

    expect(() => log.error('cannot be written')).not.toThrow();
    expect(output.lines.some(([level, args]) => level === 'warn' && String(args[0]).startsWith('[log] Could not write'))).toBe(true);
    // Still remembered for diagnostics.
    expect(log.recentProblems()).toHaveLength(1);
  });

  it('registers secret-looking environment variables', async () => {
    const log = createLogger({ directory: dir, now, env: { CLAUDE_CODE_OAUTH_TOKEN: 'env-token-value-1234', USERNAME: 'kyle' } });
    log.info('token env-token-value-1234 for kyle');
    expect(await logText()).toContain('token [REDACTED] for kyle');
  });
});
