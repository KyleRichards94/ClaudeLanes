import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRotatingFile } from './rotating-file';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-lanes-log-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const line = (n: number) => `line ${String(n).padStart(4, '0')} ${'x'.repeat(90)}\n`;

describe('createRotatingFile', () => {
  it('creates its folder and appends', async () => {
    const file = createRotatingFile({ directory: join(dir, 'logs') });
    file.write('one\n');
    file.write('two\n');
    await expect(readFile(join(dir, 'logs', 'main.log'), 'utf8')).resolves.toBe('one\ntwo\n');
    expect(file.path).toBe(join(dir, 'logs', 'main.log'));
  });

  it('rotates by size and keeps at most maxFiles files', async () => {
    const file = createRotatingFile({ directory: dir, maxBytes: 1024, maxFiles: 3 });
    for (let n = 0; n < 60; n += 1) file.write(line(n));

    expect((await readdir(dir)).sort()).toEqual(['main.1.log', 'main.2.log', 'main.log']);
    for (const name of ['main.log', 'main.1.log', 'main.2.log']) {
      const text = await readFile(join(dir, name), 'utf8');
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1024);
      expect(text.endsWith('\n')).toBe(true);
    }
    // Newest in main.log, older in .1 then .2; the oldest lines are gone.
    expect(await readFile(join(dir, 'main.log'), 'utf8')).toContain('line 0059');
    expect(await readFile(join(dir, 'main.1.log'), 'utf8')).not.toContain('line 0059');
    const all = (await Promise.all(file.paths().map((path) => readFile(path, 'utf8')))).join('');
    expect(all).not.toContain('line 0000');
  });

  it('continues an existing file and rotates it when it is already full', async () => {
    await writeFile(join(dir, 'main.log'), 'y'.repeat(1000));
    const file = createRotatingFile({ directory: dir, maxBytes: 1024, maxFiles: 2 });
    file.write(line(1));
    expect(await readFile(join(dir, 'main.1.log'), 'utf8')).toBe('y'.repeat(1000));
    expect(await readFile(join(dir, 'main.log'), 'utf8')).toBe(line(1));
  });

  it('with maxFiles 1, starts the file over instead of keeping a copy', async () => {
    const file = createRotatingFile({ directory: dir, maxBytes: 1024, maxFiles: 1 });
    for (let n = 0; n < 20; n += 1) file.write(line(n));
    expect(await readdir(dir)).toEqual(['main.log']);
    expect(Buffer.byteLength(await readFile(join(dir, 'main.log'), 'utf8'))).toBeLessThanOrEqual(1024);
  });

  it('reports a write failure once and never throws', async () => {
    const errors: unknown[] = [];
    // A file where the folder should be: every write fails.
    await writeFile(join(dir, 'blocked'), 'not a folder');
    const file = createRotatingFile({ directory: join(dir, 'blocked'), onError: (error) => errors.push(error) });

    expect(() => {
      file.write('a\n');
      file.write('b\n');
    }).not.toThrow();
    expect(errors).toHaveLength(1);
  });

  it('lists every file it may use, newest first', () => {
    const file = createRotatingFile({ directory: dir, fileName: 'app.log', maxFiles: 3 });
    expect(file.paths()).toEqual([join(dir, 'app.log'), join(dir, 'app.1.log'), join(dir, 'app.2.log')]);
  });
});
