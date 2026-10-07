import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeRecordFs, writeFileAtomic, type RecordFs } from './atomic-file';
import { createTempDir, listTree } from './testing';

let dir: string;
let remove: () => Promise<void>;

beforeEach(async () => {
  ({ dir, remove } = await createTempDir());
});

afterEach(async () => {
  await remove();
});

function errno(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe('writeFileAtomic', () => {
  it('creates missing folders, writes the file and leaves no temporary file', async () => {
    const file = join(dir, 'repo', '71273.json');
    await writeFileAtomic(nodeRecordFs, file, '{"a":1}\n');

    expect(await readFile(file, 'utf8')).toBe('{"a":1}\n');
    expect(await listTree(dir)).toEqual(['repo/', 'repo/71273.json']);
  });

  it('replaces an existing file whole', async () => {
    const file = join(dir, '71273.json');
    await writeFile(file, 'old content that is longer than the new one');
    await writeFileAtomic(nodeRecordFs, file, 'new');
    expect(await readFile(file, 'utf8')).toBe('new');
  });

  it('keeps the old file and removes the temporary one when writing fails', async () => {
    const file = join(dir, '71273.json');
    await writeFile(file, 'old');
    const failing: RecordFs = {
      ...nodeRecordFs,
      async writeFileSynced(path, data) {
        await nodeRecordFs.writeFileSynced(path, data.slice(0, 2));
        throw errno('ENOSPC');
      },
    };

    await expect(writeFileAtomic(failing, file, 'new content')).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(await readFile(file, 'utf8')).toBe('old');
    expect(await listTree(dir)).toEqual(['71273.json']);
  });

  it('retries a rename Windows refuses for a moment', async () => {
    const file = join(dir, '71273.json');
    await writeFile(file, 'old');
    let refusals = 2;
    const busy: RecordFs = {
      ...nodeRecordFs,
      async rename(from, to) {
        if (refusals-- > 0) throw errno('EPERM');
        await nodeRecordFs.rename(from, to);
      },
    };

    await writeFileAtomic(busy, file, 'new');
    expect(await readFile(file, 'utf8')).toBe('new');
    expect(await listTree(dir)).toEqual(['71273.json']);
  });

  it('gives up on a rename that keeps failing and keeps the old file', async () => {
    const file = join(dir, '71273.json');
    await writeFile(file, 'old');
    const locked: RecordFs = {
      ...nodeRecordFs,
      rename: () => Promise.reject(errno('EACCES')),
    };

    await expect(writeFileAtomic(locked, file, 'new')).rejects.toMatchObject({ code: 'EACCES' });
    expect(await readFile(file, 'utf8')).toBe('old');
    expect(await listTree(dir)).toEqual(['71273.json']);
  });
});
