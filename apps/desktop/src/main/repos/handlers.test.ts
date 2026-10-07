import { join } from 'node:path';
import { ok, type AddRepoResponse, type Result } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import { handleInvoke } from '../ipc/handle-invoke';
import { createRepoSettings } from '../settings/repo-settings';
import { createReposHandlers } from './handlers';
import type { RepoRegistry } from './registry';

const osc = createRepoSettings(join('C:', 'src', 'onsite-companion'));
const lanes = createRepoSettings(join('C:', 'src', 'agent-lanes'));

function fakeRegistry(add: Result<AddRepoResponse>): RepoRegistry {
  return {
    list: vi.fn(() => [osc, lanes]),
    add: vi.fn(async () => add),
    remove: vi.fn((path: string) => ok({ removed: path === osc.path, repos: [lanes] })),
  };
}

describe('repos IPC handlers', () => {
  it('repos:list returns the registered repos', async () => {
    const handlers = createReposHandlers({ repos: fakeRegistry(ok({ status: 'cancelled', repos: [] })) });
    await expect(handleInvoke('repos:list', undefined, handlers['repos:list'])).resolves.toEqual({ ok: true, data: [osc, lanes] });
  });

  it('repos:add takes no path from the renderer', async () => {
    const repos = fakeRegistry(ok({ status: 'added', repo: osc, repos: [osc] }));
    const handlers = createReposHandlers({ repos });

    const refused = await handleInvoke('repos:add', { path: lanes.path }, handlers['repos:add']);
    expect(refused).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(repos.add).not.toHaveBeenCalled();

    await expect(handleInvoke('repos:add', undefined, handlers['repos:add'])).resolves.toEqual({
      ok: true,
      data: { status: 'added', repo: osc, repos: [osc] },
    });
  });

  it('repos:add passes a refused folder through as a rejected outcome', async () => {
    const folder = join('C:', 'Users', 'kyle', 'Downloads');
    const handlers = createReposHandlers({ repos: fakeRegistry(ok({ status: 'rejected', reason: 'not-a-repo', folder, repos: [] })) });
    await expect(handleInvoke('repos:add', undefined, handlers['repos:add'])).resolves.toEqual({
      ok: true,
      data: { status: 'rejected', reason: 'not-a-repo', folder, repos: [] },
    });
  });

  it('repos:remove needs a path and nothing else', async () => {
    const repos = fakeRegistry(ok({ status: 'cancelled', repos: [] }));
    const handlers = createReposHandlers({ repos });

    await expect(handleInvoke('repos:remove', {}, handlers['repos:remove'])).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
    await expect(handleInvoke('repos:remove', { path: osc.path, force: true }, handlers['repos:remove'])).resolves.toMatchObject({
      ok: false,
      code: 'VALIDATION',
    });
    expect(repos.remove).not.toHaveBeenCalled();

    await expect(handleInvoke('repos:remove', { path: osc.path }, handlers['repos:remove'])).resolves.toEqual({
      ok: true,
      data: { removed: true, repos: [lanes] },
    });
  });
});
