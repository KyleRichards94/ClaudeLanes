import { ok, type DesignViewState } from '@agent-lanes/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTicketRecordStore, type TicketRecordStore } from '../tickets';
import { createTempDir, newTicketInput } from '../tickets/testing';
import { createDesignCanvasLinks, isCanvasPage } from './canvas-links';

const CANVAS_URL = 'https://claude.ai/design/p/p-71273';
const ARTBOARD_URL = `${CANVAS_URL}#artboard=jobfilter`;

/** A view service stand-in: remembers the URL each ticket's live view was opened with. */
function fakeViews() {
  const live = new Map<string, string>();
  const designView = {
    open: vi.fn((ticketId: string, url: string) => {
      live.set(ticketId, url);
      return ok<DesignViewState>({ ticketId, status: 'loading', url: null, visible: true });
    }),
    close: vi.fn((ticketId: string) => live.delete(ticketId)),
    get: vi.fn((ticketId: string) => (live.has(ticketId) ? { ticketId, status: 'signed-in' as const, url: live.get(ticketId) ?? null, visible: true } : undefined)),
  };
  return { designView, live };
}

describe('design canvas links', () => {
  let cleanup: (() => Promise<void>) | undefined;
  const stores: TicketRecordStore[] = [];

  afterEach(async () => {
    for (const store of stores.splice(0)) await store.dispose();
    await cleanup?.();
    cleanup = undefined;
  });

  async function setUp() {
    const temp = await createTempDir();
    cleanup = temp.remove;
    const open = () => {
      const store = createTicketRecordStore({ rootDir: temp.dir, warn: () => undefined, debounceMs: 0 });
      stores.push(store);
      return store;
    };
    const tickets = open();
    expect((await tickets.create(newTicketInput(temp.dir))).ok).toBe(true);
    return { tickets, reopen: open };
  }

  it('links a pasted canvas link to the ticket record', async () => {
    const { tickets } = await setUp();
    const links = createDesignCanvasLinks({ tickets, designView: fakeViews().designView });

    const result = await links.link('71273', `claude.ai/design/p/p-71273?utm=share`);

    expect(result).toEqual(ok({ canvas: { kind: 'design-project', id: 'p-71273', url: CANVAS_URL }, lastViewUrl: null, specs: [] }));
    expect((await tickets.get('71273'))?.design.canvas?.url).toBe(CANVAS_URL);
  });

  it('refuses links that are not canvases, and unknown tickets', async () => {
    const { tickets } = await setUp();
    const links = createDesignCanvasLinks({ tickets, designView: fakeViews().designView });

    expect(await links.link('71273', 'https://claude.ai/chat/abc')).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await links.link('71273', 'https://evil.example/design/p/abc')).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await links.link('99999', CANVAS_URL)).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect((await tickets.get('71273'))?.design.canvas).toBeNull();
  });

  it('remembers the signed-in canvas page and reopens a linked canvas on it after a restart', async () => {
    const { tickets, reopen } = await setUp();
    const first = fakeViews();
    const links = createDesignCanvasLinks({ tickets, designView: first.designView });
    await links.link('71273', CANVAS_URL);

    expect((await links.open('71273')).ok).toBe(true);
    expect(first.designView.open).toHaveBeenLastCalledWith('71273', CANVAS_URL, undefined);

    // The user picks an artboard inside the canvas; then wanders off it, which is not remembered.
    links.noteView({ ticketId: '71273', status: 'signed-in', url: ARTBOARD_URL, visible: true }, false);
    await vi.waitFor(async () => expect((await tickets.get('71273'))?.design.lastViewUrl).toBe(ARTBOARD_URL));
    links.noteView({ ticketId: '71273', status: 'signed-in', url: 'https://claude.ai/design/p/other', visible: true }, false);
    links.noteView({ ticketId: '71273', status: 'signed-out', url: 'https://claude.ai/login', visible: true }, false);

    // Reopening the live view shows it as it is: same URL, so the view service does not navigate.
    await links.open('71273');
    expect(first.designView.open).toHaveBeenLastCalledWith('71273', CANVAS_URL, undefined);

    // Restart: a new record store over the same folder and a new view service.
    await tickets.dispose();
    const restarted = reopen();
    const second = fakeViews();
    const afterRestart = createDesignCanvasLinks({ tickets: restarted, designView: second.designView });
    await afterRestart.open('71273', { x: 0, y: 0, width: 800, height: 600 });
    expect(second.designView.open).toHaveBeenCalledWith('71273', ARTBOARD_URL, { x: 0, y: 0, width: 800, height: 600 });
  });

  it('a closed view (live-view limit) reopens on the last page too', async () => {
    const { tickets } = await setUp();
    const views = fakeViews();
    const links = createDesignCanvasLinks({ tickets, designView: views.designView });
    await links.link('71273', CANVAS_URL);
    await links.open('71273');
    links.noteView({ ticketId: '71273', status: 'signed-in', url: ARTBOARD_URL, visible: true }, false);
    await vi.waitFor(async () => expect((await tickets.get('71273'))?.design.lastViewUrl).toBe(ARTBOARD_URL));

    views.live.delete('71273');
    links.noteView({ ticketId: '71273', status: 'signed-in', url: ARTBOARD_URL, visible: false }, true);
    await links.open('71273');
    expect(views.designView.open).toHaveBeenLastCalledWith('71273', ARTBOARD_URL, undefined);
  });

  it('linking another canvas forgets the last page and closes the old view; unlinking clears it', async () => {
    const { tickets } = await setUp();
    const views = fakeViews();
    const links = createDesignCanvasLinks({ tickets, designView: views.designView });
    await links.link('71273', CANVAS_URL);
    await links.open('71273');
    links.noteView({ ticketId: '71273', status: 'signed-in', url: ARTBOARD_URL, visible: true }, false);
    await vi.waitFor(async () => expect((await tickets.get('71273'))?.design.lastViewUrl).toBe(ARTBOARD_URL));

    const relinked = await links.link('71273', 'https://claude.ai/artifact/art-2');
    expect(relinked).toMatchObject({ ok: true, data: { canvas: { kind: 'artifact', id: 'art-2' }, lastViewUrl: null } });
    expect(views.designView.close).toHaveBeenCalledWith('71273');

    await links.open('71273');
    expect(views.designView.open).toHaveBeenLastCalledWith('71273', 'https://claude.ai/artifact/art-2', undefined);

    expect(await links.unlink('71273')).toMatchObject({ ok: true, data: { canvas: null, lastViewUrl: null } });
    expect(await links.open('71273')).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('maps claude.ai to the e2e stand-in and back', async () => {
    const { tickets } = await setUp();
    const views = fakeViews();
    const links = createDesignCanvasLinks({ tickets, designView: views.designView, testOrigin: 'http://127.0.0.1:4321' });
    await links.link('71273', CANVAS_URL);

    await links.open('71273');
    expect(views.designView.open).toHaveBeenLastCalledWith('71273', 'http://127.0.0.1:4321/design/p/p-71273', undefined);

    links.noteView({ ticketId: '71273', status: 'signed-in', url: 'http://127.0.0.1:4321/design/p/p-71273#artboard=jobfilter', visible: true }, false);
    await vi.waitFor(async () => expect((await tickets.get('71273'))?.design.lastViewUrl).toBe(ARTBOARD_URL));
  });

  it('tells canvas pages from other pages', () => {
    const canvas = { kind: 'design-project' as const, id: 'p-71273', url: CANVAS_URL };
    expect(isCanvasPage(canvas, CANVAS_URL)).toBe(true);
    expect(isCanvasPage(canvas, `${CANVAS_URL}/a/b`)).toBe(true);
    expect(isCanvasPage(canvas, `${CANVAS_URL}?x=1`)).toBe(true);
    expect(isCanvasPage(canvas, `${CANVAS_URL}-other`)).toBe(false);
    expect(isCanvasPage(canvas, 'https://claude.ai/design')).toBe(false);
  });
});
