import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GitStatus } from '../git';
import { createGitFingerprint } from './freshness';

let dir: string;
let status: GitStatus;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-lanes-fingerprint-'));
  writeFileSync(join(dir, 'a.cs'), 'class A {}');
  status = {
    branch: { oid: 'abc123', head: '71273-cutover', detached: false, upstream: null, ahead: null, behind: null },
    entries: [{ kind: 'changed', index: '.', worktree: 'M', submodule: 'N...', path: 'a.cs' }],
    stash: null,
  };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const fingerprint = () => createGitFingerprint({ status: () => Promise.resolve(structuredClone(status)) })(dir);

describe('createGitFingerprint', () => {
  it('stays the same while nothing changes', async () => {
    expect(await fingerprint()).toBe(await fingerprint());
  });

  it('changes with a new commit, an edited file or a new untracked file, not with ignored output', async () => {
    const first = await fingerprint();

    status.entries.push({ kind: 'ignored', path: 'bin/Debug/App.dll' });
    expect(await fingerprint()).toBe(first);

    writeFileSync(join(dir, 'a.cs'), 'class A { int x; }');
    utimesSync(join(dir, 'a.cs'), new Date(2030, 0, 1), new Date(2030, 0, 1));
    const edited = await fingerprint();
    expect(edited).not.toBe(first);

    status.entries.push({ kind: 'untracked', path: 'b.cs' });
    const untracked = await fingerprint();
    expect(untracked).not.toBe(edited);

    status.branch = { ...status.branch!, oid: 'def456' };
    expect(await fingerprint()).not.toBe(untracked);
  });

  it('is null when git cannot read the worktree', async () => {
    await expect(createGitFingerprint({ status: () => Promise.reject(new Error('not a git repository')) })(dir)).resolves.toBeNull();
  });
});
