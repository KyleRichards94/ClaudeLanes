import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { killTree } from './kill-tree';
import { startCommand } from './start-command';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === 'EPERM';
  }
}

describe('killTree', () => {
  it('ends the whole tree with taskkill /T /F on Windows', async () => {
    const taskkill = vi.fn(() => Promise.resolve());
    await killTree(4242, { platform: 'win32', taskkill });
    expect(taskkill).toHaveBeenCalledExactlyOnceWith(['/PID', '4242', '/T', '/F']);
  });

  it('sends SIGTERM to the process group elsewhere, then SIGKILL when it lingers', async () => {
    const sent: [number, NodeJS.Signals | 0][] = [];
    const signal = vi.fn((pid: number, name: NodeJS.Signals | 0) => void sent.push([pid, name]));
    await killTree(4242, { platform: 'linux', signal, graceMs: 30 });
    expect(sent[0]).toEqual([-4242, 'SIGTERM']);
    expect(sent.at(-1)).toEqual([-4242, 'SIGKILL']);
  });

  it('stops after SIGTERM once the group is gone', async () => {
    const sent: [number, NodeJS.Signals | 0][] = [];
    const signal = vi.fn((pid: number, name: NodeJS.Signals | 0) => {
      sent.push([pid, name]);
      if (name === 0) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
    });
    await killTree(4242, { platform: 'darwin', signal, graceMs: 1_000 });
    expect(sent.filter(([, name]) => name !== 0)).toEqual([[-4242, 'SIGTERM']]);
  });

  it('ignores pids that cannot be a process', async () => {
    const taskkill = vi.fn(() => Promise.resolve());
    await killTree(0, { platform: 'win32', taskkill });
    await killTree(Number.NaN, { platform: 'win32', taskkill });
    expect(taskkill).not.toHaveBeenCalled();
  });

  it('leaves no child or grandchild behind when a real command is killed', { timeout: 20_000 }, async () => {
    // The shell starts node, which starts another node: the shape of `dotnet run` starting the app.
    const dir = mkdtempSync(join(tmpdir(), 'agent-lanes-kill-tree-'));
    writeFileSync(join(dir, 'grandchild.js'), "setInterval(() => {}, 1000); console.log('grandchild=' + process.pid);");
    writeFileSync(
      join(dir, 'parent.js'),
      "require('child_process').spawn(process.execPath, ['grandchild.js'], { stdio: 'inherit' }); console.log('child=' + process.pid); setInterval(() => {}, 1000);",
    );
    const pids: Record<string, number> = {};
    const child = startCommand({
      command: 'node parent.js',
      cwd: dir,
      onLine: (_, text) => {
        const match = /^(child|grandchild)=(\d+)$/.exec(text);
        if (match) pids[match[1]!] = Number(match[2]);
      },
    });
    await vi.waitFor(() => expect(Object.keys(pids).sort()).toEqual(['child', 'grandchild']), { timeout: 10_000 });
    expect(isAlive(pids['child']!)).toBe(true);
    expect(isAlive(pids['grandchild']!)).toBe(true);

    await child.kill();
    const exit = await child.exit;
    expect(exit.exitCode === 0).toBe(false);
    await vi.waitFor(() => {
      expect(isAlive(pids['child']!)).toBe(false);
      expect(isAlive(pids['grandchild']!)).toBe(false);
    });
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
});
