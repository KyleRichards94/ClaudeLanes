import { ok } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import { handleInvoke } from '../ipc/handle-invoke';
import { createDesignHandlers } from './handlers';
import type { DesignArtboardReader } from './artboards';
import type { DesignCanvasLinks } from './canvas-links';
import type { DesignShipService } from './ship';
import type { DesignSpecService } from './specs';
import { fakeSpec } from './testing/specs';
import type { DesignThreadService } from './thread';
import type { DesignViewService } from './view-service';

const VIEW = { ticketId: '71273', status: 'signed-in' as const, url: 'https://claude.ai/design/p/a', visible: true };

function fakeService(): DesignViewService {
  return {
    open: vi.fn(() => ok(VIEW)),
    setBounds: vi.fn(() => true),
    hide: vi.fn(() => true),
    reload: vi.fn(() => true),
    close: vi.fn(() => false),
    get: vi.fn(() => undefined),
    list: vi.fn(() => []),
    dispose: vi.fn(async () => undefined),
  };
}

const DESIGN = { canvas: { kind: 'design-project' as const, id: 'a', url: 'https://claude.ai/design/p/a' }, lastViewUrl: null, specs: [] };

function fakeCanvases(): DesignCanvasLinks {
  return {
    link: vi.fn(async () => ok(DESIGN)),
    unlink: vi.fn(async () => ok({ ...DESIGN, canvas: null })),
    open: vi.fn(async () => ok(VIEW)),
    noteView: vi.fn(),
  };
}

const ARTBOARDS = { status: 'ok' as const, artboards: [{ id: 'a.html', name: 'A', width: 1440, height: 900 }], readAt: 1 };

function fakeArtboards(): DesignArtboardReader {
  return { list: vi.fn(async () => ok(ARTBOARDS)) };
}

const SHIPPED = { spec: { version: 1, shippedAt: 5, approvedBy: 'Kyle', artboardCount: 1, usedAt: null, fetchedAt: null, deliveredAt: 6 }, delivered: true };

function fakeShip(): DesignShipService {
  return { ship: vi.fn(async () => ok(SHIPPED)), reship: vi.fn(async () => ok(SHIPPED)), deliverPending: vi.fn(async () => false), dispose: vi.fn() };
}

function fakeSpecs(): DesignSpecService {
  return { list: vi.fn(async () => ok([])), get: vi.fn(async () => ok(fakeSpec(1))), ack: vi.fn(async () => ok(SHIPPED.spec)) };
}

const THREAD = { ticketId: '71273', status: 'idle' as const, reason: null, messages: [], approval: null };

function fakeThreads(): DesignThreadService {
  return {
    get: vi.fn(async () => ok(THREAD)),
    send: vi.fn(async () => ok({ ...THREAD, status: 'replying' as const })),
    answer: vi.fn(async () => ok(THREAD)),
    dispose: vi.fn(async () => undefined),
  };
}

describe('design IPC handlers', () => {
  it('design:getSpec reads a version for the design tab without marking it fetched, and design:reshipSpec ships it again (AL-199)', async () => {
    const designShip = fakeShip();
    const designSpecs = fakeSpecs();
    const handlers = createDesignHandlers({ designShip, designSpecs, designView: fakeService(), designCanvases: fakeCanvases(), designArtboards: fakeArtboards(), designThreads: fakeThreads() });
    expect(await handleInvoke('design:getSpec', { ticketId: '71273', version: 1 }, handlers['design:getSpec'])).toEqual(ok(fakeSpec(1)));
    expect(designSpecs.get).toHaveBeenCalledWith('71273', 1);
    expect(await handleInvoke('design:reshipSpec', { ticketId: '71273', version: 1 }, handlers['design:reshipSpec'])).toEqual(ok(SHIPPED));
    expect(designShip.reship).toHaveBeenCalledWith('71273', 1);
  });

  it('design:shipSpec ships the picked artboards (AL-197) and refuses an empty pick before main sees it', async () => {
    const designShip = fakeShip();
    const handlers = createDesignHandlers({ designShip, designSpecs: fakeSpecs(), designView: fakeService(), designCanvases: fakeCanvases(), designArtboards: fakeArtboards(), designThreads: fakeThreads() });
    const request = { ticketId: '71273', artboards: [{ id: 'a.html', name: 'A', width: 1440, height: 900 }], note: 'Use the compact grid' };
    expect(await handleInvoke('design:shipSpec', request, handlers['design:shipSpec'])).toEqual(ok(SHIPPED));
    expect(designShip.ship).toHaveBeenCalledWith(request);
    await expect(handleInvoke('design:shipSpec', { ticketId: '71273', artboards: [] }, handlers['design:shipSpec'])).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(designShip.ship).toHaveBeenCalledOnce();
  });

  it('design:getThread, design:sendThreadMessage and design:answerThreadApproval go to the design thread', async () => {
    const designThreads = fakeThreads();
    const handlers = createDesignHandlers({ designShip: fakeShip(), designSpecs: fakeSpecs(), designView: fakeService(), designCanvases: fakeCanvases(), designArtboards: fakeArtboards(), designThreads });

    expect(await handleInvoke('design:getThread', { ticketId: '71273' }, handlers['design:getThread'])).toEqual(ok(THREAD));
    expect(await handleInvoke('design:sendThreadMessage', { ticketId: '71273', text: '  Tighten the grid  ' }, handlers['design:sendThreadMessage'])).toEqual(
      ok({ ...THREAD, status: 'replying' }),
    );
    expect(designThreads.send).toHaveBeenCalledWith('71273', 'Tighten the grid');
    await handleInvoke('design:answerThreadApproval', { ticketId: '71273', approvalId: 'a1', approve: true }, handlers['design:answerThreadApproval']);
    expect(designThreads.answer).toHaveBeenCalledWith('71273', 'a1', true);
  });

  it('design:sendThreadMessage refuses an empty message before reaching the thread', async () => {
    const designThreads = fakeThreads();
    const handlers = createDesignHandlers({ designShip: fakeShip(), designSpecs: fakeSpecs(), designView: fakeService(), designCanvases: fakeCanvases(), designArtboards: fakeArtboards(), designThreads });
    expect(await handleInvoke('design:sendThreadMessage', { ticketId: '71273', text: '   ' }, handlers['design:sendThreadMessage'])).toMatchObject({
      ok: false,
      code: 'VALIDATION',
    });
    expect(designThreads.send).not.toHaveBeenCalled();
  });

  it('design:listArtboards reads the ticket canvas through the artboard reader', async () => {
    const designArtboards = fakeArtboards();
    const handlers = createDesignHandlers({ designShip: fakeShip(), designSpecs: fakeSpecs(), designView: fakeService(), designCanvases: fakeCanvases(), designArtboards, designThreads: fakeThreads() });
    expect(await handleInvoke('design:listArtboards', { ticketId: '71273' }, handlers['design:listArtboards'])).toEqual(ok(ARTBOARDS));
    expect(designArtboards.list).toHaveBeenCalledWith('71273');
  });

  it('design:linkCanvas, design:unlinkCanvas and design:openCanvas go to the canvas links', async () => {
    const designCanvases = fakeCanvases();
    const handlers = createDesignHandlers({ designShip: fakeShip(), designSpecs: fakeSpecs(), designView: fakeService(), designCanvases, designArtboards: fakeArtboards(), designThreads: fakeThreads() });
    const bounds = { x: 1, y: 2, width: 3, height: 4 };

    expect(await handleInvoke('design:linkCanvas', { ticketId: '71273', url: ' https://claude.ai/design/p/a ' }, handlers['design:linkCanvas'])).toEqual(ok(DESIGN));
    expect(designCanvases.link).toHaveBeenCalledWith('71273', 'https://claude.ai/design/p/a');
    expect(await handleInvoke('design:unlinkCanvas', { ticketId: '71273' }, handlers['design:unlinkCanvas'])).toEqual(ok({ ...DESIGN, canvas: null }));
    expect(await handleInvoke('design:openCanvas', { ticketId: '71273', bounds }, handlers['design:openCanvas'])).toEqual(ok(VIEW));
    expect(designCanvases.open).toHaveBeenCalledWith('71273', bounds);
  });

  it('design:open passes the ticket, URL and bounds to the service', async () => {
    const designView = fakeService();
    const handlers = createDesignHandlers({ designShip: fakeShip(), designSpecs: fakeSpecs(), designView, designCanvases: fakeCanvases(), designArtboards: fakeArtboards(), designThreads: fakeThreads() });
    const bounds = { x: 1, y: 2, width: 3, height: 4 };

    const result = await handleInvoke('design:open', { ticketId: '71273', url: VIEW.url, bounds }, handlers['design:open']);

    expect(result).toEqual(ok(VIEW));
    expect(designView.open).toHaveBeenCalledWith('71273', VIEW.url, bounds);
  });

  it('design:open refuses a request that is not a URL before reaching the service', async () => {
    const designView = fakeService();
    const handlers = createDesignHandlers({ designShip: fakeShip(), designSpecs: fakeSpecs(), designView, designCanvases: fakeCanvases(), designArtboards: fakeArtboards(), designThreads: fakeThreads() });

    const result = await handleInvoke('design:open', { ticketId: '71273', url: 'claude.ai/design' }, handlers['design:open']);

    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(designView.open).not.toHaveBeenCalled();
  });

  it('design:setBounds refuses negative sizes', async () => {
    const handlers = createDesignHandlers({ designShip: fakeShip(), designSpecs: fakeSpecs(), designView: fakeService(), designCanvases: fakeCanvases(), designArtboards: fakeArtboards(), designThreads: fakeThreads() });
    const result = await handleInvoke(
      'design:setBounds',
      { ticketId: '71273', bounds: { x: 0, y: 0, width: -1, height: 10 } },
      handlers['design:setBounds'],
    );
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('design:setBounds, design:hide and design:close report whether the ticket had a view', async () => {
    const handlers = createDesignHandlers({ designShip: fakeShip(), designSpecs: fakeSpecs(), designView: fakeService(), designCanvases: fakeCanvases(), designArtboards: fakeArtboards(), designThreads: fakeThreads() });
    const bounds = { x: 0, y: 0, width: 10, height: 10 };

    expect(await handleInvoke('design:setBounds', { ticketId: '71273', bounds }, handlers['design:setBounds'])).toEqual(ok({ found: true }));
    expect(await handleInvoke('design:hide', { ticketId: '71273' }, handlers['design:hide'])).toEqual(ok({ found: true }));
    expect(await handleInvoke('design:close', { ticketId: '71273' }, handlers['design:close'])).toEqual(ok({ found: false }));
    expect(await handleInvoke('design:reload', { ticketId: '71273' }, handlers['design:reload'])).toEqual(ok({ found: true }));
  });

  it('design:getView returns null when the ticket has no live view', async () => {
    const handlers = createDesignHandlers({ designShip: fakeShip(), designSpecs: fakeSpecs(), designView: fakeService(), designCanvases: fakeCanvases(), designArtboards: fakeArtboards(), designThreads: fakeThreads() });
    expect(await handleInvoke('design:getView', { ticketId: '71273' }, handlers['design:getView'])).toEqual(ok({ view: null }));
  });
});
