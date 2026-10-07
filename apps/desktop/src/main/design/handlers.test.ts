import { ok } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import { handleInvoke } from '../ipc/handle-invoke';
import { createDesignHandlers } from './handlers';
import type { DesignViewService } from './view-service';

const VIEW = { ticketId: '71273', status: 'signed-in' as const, url: 'https://claude.ai/design/p/a', visible: true };

function fakeService(): DesignViewService {
  return {
    open: vi.fn(() => ok(VIEW)),
    setBounds: vi.fn(() => true),
    hide: vi.fn(() => true),
    close: vi.fn(() => false),
    get: vi.fn(() => undefined),
    list: vi.fn(() => []),
    dispose: vi.fn(async () => undefined),
  };
}

describe('design IPC handlers', () => {
  it('design:open passes the ticket, URL and bounds to the service', async () => {
    const designView = fakeService();
    const handlers = createDesignHandlers({ designView });
    const bounds = { x: 1, y: 2, width: 3, height: 4 };

    const result = await handleInvoke('design:open', { ticketId: '71273', url: VIEW.url, bounds }, handlers['design:open']);

    expect(result).toEqual(ok(VIEW));
    expect(designView.open).toHaveBeenCalledWith('71273', VIEW.url, bounds);
  });

  it('design:open refuses a request that is not a URL before reaching the service', async () => {
    const designView = fakeService();
    const handlers = createDesignHandlers({ designView });

    const result = await handleInvoke('design:open', { ticketId: '71273', url: 'claude.ai/design' }, handlers['design:open']);

    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(designView.open).not.toHaveBeenCalled();
  });

  it('design:setBounds refuses negative sizes', async () => {
    const handlers = createDesignHandlers({ designView: fakeService() });
    const result = await handleInvoke(
      'design:setBounds',
      { ticketId: '71273', bounds: { x: 0, y: 0, width: -1, height: 10 } },
      handlers['design:setBounds'],
    );
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('design:setBounds, design:hide and design:close report whether the ticket had a view', async () => {
    const handlers = createDesignHandlers({ designView: fakeService() });
    const bounds = { x: 0, y: 0, width: 10, height: 10 };

    expect(await handleInvoke('design:setBounds', { ticketId: '71273', bounds }, handlers['design:setBounds'])).toEqual(ok({ found: true }));
    expect(await handleInvoke('design:hide', { ticketId: '71273' }, handlers['design:hide'])).toEqual(ok({ found: true }));
    expect(await handleInvoke('design:close', { ticketId: '71273' }, handlers['design:close'])).toEqual(ok({ found: false }));
  });

  it('design:getView returns null when the ticket has no live view', async () => {
    const handlers = createDesignHandlers({ designView: fakeService() });
    expect(await handleInvoke('design:getView', { ticketId: '71273' }, handlers['design:getView'])).toEqual(ok({ view: null }));
  });
});
