import { err, ok } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import { handleInvoke } from '../ipc/handle-invoke';
import { createPrHandlers } from './handlers';
import type { PullRequestService } from './service';

const draft = {
  title: 'Cutover frmJobControl to Blazor',
  description: 'Done.',
  sourceBranch: '71273-cutover',
  targetBranch: 'main',
  workItemId: 71273,
  repository: 'OnSite Companion / onsite-companion',
  blocked: null,
};

function service(overrides: Partial<PullRequestService> = {}): PullRequestService {
  return {
    draft: vi.fn(async () => ok(draft)),
    create: vi.fn(async () => err('VALIDATION', 'not in Create PR')),
    refresh: vi.fn(async () => ok(null)),
    watch: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  };
}

describe('pr IPC handlers (AL-181)', () => {
  it('pr:draft returns the draft through the contract', async () => {
    const handlers = createPrHandlers({ pullRequests: service() });
    await expect(handleInvoke('pr:draft', { ticketId: '71273' }, handlers['pr:draft'])).resolves.toEqual({ ok: true, data: draft });
    await expect(handleInvoke('pr:draft', { ticketId: '' }, handlers['pr:draft'])).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('pr:create refuses an empty title before the service sees it, and passes the service error on', async () => {
    const pullRequests = service();
    const handlers = createPrHandlers({ pullRequests });
    await expect(handleInvoke('pr:create', { ticketId: '71273', title: '  ', description: '' }, handlers['pr:create'])).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(pullRequests.create).not.toHaveBeenCalled();
    await expect(handleInvoke('pr:create', { ticketId: '71273', title: 'T', description: '' }, handlers['pr:create'])).resolves.toMatchObject({
      ok: false,
      message: 'not in Create PR',
    });
  });

  it('pr:get wraps the refreshed state', async () => {
    const handlers = createPrHandlers({ pullRequests: service() });
    await expect(handleInvoke('pr:get', { ticketId: '71273' }, handlers['pr:get'])).resolves.toEqual({ ok: true, data: { state: null } });
  });
});
