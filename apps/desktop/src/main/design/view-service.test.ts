import { describe, expect, it, vi } from 'vitest';
import type { Emit } from '../ipc/emit';
import { createDesignNavigationPolicy } from './navigation';
import {
  createDesignViewService,
  type DesignHostWindow,
  type DesignViewCallbacks,
  type DesignViewHandle,
  type DesignViewPlatform,
  type ViewRect,
} from './view-service';

const CANVAS_A = 'https://claude.ai/design/p/canvas-a';
const CANVAS_B = 'https://claude.ai/design/p/canvas-b';
const BOUNDS = { x: 240.4, y: 120.6, width: 800, height: 600 };

interface FakeView extends DesignViewHandle {
  loads: string[];
  rect: ViewRect | undefined;
  visible: boolean;
  destroyed: boolean;
  callbacks: DesignViewCallbacks;
}

function fakePlatform(zoom = 1) {
  const views: FakeView[] = [];
  const attached = new Set<DesignViewHandle>();
  let hasWindow = true;
  const host: DesignHostWindow = {
    add: (view) => attached.add(view),
    remove: (view) => attached.delete(view),
    zoomFactor: () => zoom,
  };
  const platform: DesignViewPlatform = {
    createView(callbacks) {
      const view: FakeView = {
        webContentsId: views.length + 1,
        loads: [],
        rect: undefined,
        visible: true,
        destroyed: false,
        callbacks,
        load(url) {
          this.loads.push(url);
        },
        setBounds(rect) {
          this.rect = rect;
        },
        setVisible(visible) {
          this.visible = visible;
        },
        destroy() {
          this.destroyed = true;
        },
      };
      views.push(view);
      return view;
    },
    window: () => (hasWindow ? host : undefined),
    flush: vi.fn(async () => undefined),
  };
  return {
    platform,
    views,
    attached,
    closeWindow: () => {
      hasWindow = false;
    },
  };
}

function setup(options: { zoom?: number; maxLiveViews?: number } = {}) {
  const fake = fakePlatform(options.zoom);
  const emit = vi.fn() as unknown as Emit & ReturnType<typeof vi.fn>;
  const service = createDesignViewService({
    platform: fake.platform,
    policy: createDesignNavigationPolicy(),
    emit,
    maxLiveViews: options.maxLiveViews,
  });
  return { ...fake, emit, service };
}

function open(service: ReturnType<typeof setup>['service'], ticketId: string, url: string, bounds = BOUNDS) {
  const result = service.open(ticketId, url, bounds);
  if (!result.ok) throw new Error(result.message);
  return result.data;
}

describe('design view service', () => {
  it('creates one view per ticket, loads the canvas and shows it over the placeholder', () => {
    const { service, views, attached } = setup();

    expect(open(service, '71273', CANVAS_A)).toEqual({ ticketId: '71273', status: 'loading', url: null, visible: true });

    expect(views).toHaveLength(1);
    expect(views[0]?.loads).toEqual([CANVAS_A]);
    expect(views[0]?.visible).toBe(true);
    expect(views[0]?.rect).toEqual({ x: 240, y: 121, width: 800, height: 600 });
    expect(attached.has(views[0]!)).toBe(true);
  });

  it('hides the view when the user leaves the tab and shows the same view, unreloaded, on return (R11)', () => {
    const { service, views } = setup();
    open(service, '71273', CANVAS_A);

    expect(service.hide('71273')).toBe(true);
    expect(views[0]?.visible).toBe(false);
    expect(views[0]?.destroyed).toBe(false);
    expect(service.get('71273')?.visible).toBe(false);

    open(service, '71273', CANVAS_A);
    expect(views).toHaveLength(1);
    expect(views[0]?.loads).toEqual([CANVAS_A]);
    expect(views[0]?.visible).toBe(true);
  });

  it('keeps the page the user navigated to inside the canvas when the tab reopens', () => {
    const { service, views } = setup();
    open(service, '71273', CANVAS_A);
    views[0]?.callbacks.onNavigated(`${CANVAS_A}?artboard=3`);
    service.hide('71273');

    expect(open(service, '71273', CANVAS_A).url).toBe(`${CANVAS_A}?artboard=3`);
    expect(views[0]?.loads).toEqual([CANVAS_A]);
  });

  it('navigates when the ticket is linked to a different canvas', () => {
    const { service, views } = setup();
    open(service, '71273', CANVAS_A);
    views[0]?.callbacks.onNavigated(CANVAS_A);

    expect(open(service, '71273', CANVAS_B).status).toBe('loading');
    expect(views[0]?.loads).toEqual([CANVAS_A, CANVAS_B]);
    expect(views).toHaveLength(1);
  });

  it('shows one canvas at a time', () => {
    const { service, views } = setup();
    open(service, '1', CANVAS_A);
    open(service, '2', CANVAS_B);

    expect(views.map((view) => view.visible)).toEqual([false, true]);
    expect(service.list().map((view) => [view.ticketId, view.visible])).toEqual([
      ['1', false],
      ['2', true],
    ]);
  });

  it('follows the placeholder and applies the renderer zoom factor', () => {
    const { service, views } = setup({ zoom: 1.25 });
    open(service, '71273', CANVAS_A, { x: 100, y: 40, width: 640, height: 480 });
    expect(views[0]?.rect).toEqual({ x: 125, y: 50, width: 800, height: 600 });

    expect(service.setBounds('71273', { x: 0, y: 0, width: 320.2, height: 200 })).toBe(true);
    expect(views[0]?.rect).toEqual({ x: 0, y: 0, width: 400, height: 250 });
  });

  it('reuses the last bounds when reopened without new ones', () => {
    const { service, views } = setup();
    open(service, '71273', CANVAS_A);
    service.hide('71273');
    views[0]!.rect = undefined;

    service.open('71273', CANVAS_A);
    expect(views[0]?.rect).toEqual({ x: 240, y: 121, width: 800, height: 600 });
  });

  it('closes the least recently opened view beyond the live-view limit', () => {
    const { service, views, attached, emit } = setup({ maxLiveViews: 3 });
    open(service, '1', CANVAS_A);
    open(service, '2', CANVAS_A);
    open(service, '3', CANVAS_A);
    open(service, '1', CANVAS_A); // 1 is now the most recent
    open(service, '4', CANVAS_A);

    expect(service.list().map((view) => view.ticketId)).toEqual(['3', '1', '4']);
    expect(views.map((view) => view.destroyed)).toEqual([false, true, false, false]);
    expect(attached.has(views[1]!)).toBe(false);
    expect(service.get('2')).toBeUndefined();
    expect(emit).toHaveBeenCalledWith('design:view', expect.objectContaining({ ticketId: '2', closed: true, visible: false }));
  });

  it('refuses URLs outside the allow-list without creating a view', () => {
    const { service, views } = setup();
    for (const url of ['https://example.com/', 'http://localhost:5173/', 'file:///C:/out/renderer/index.html']) {
      const result = service.open('71273', url, BOUNDS);
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
    }
    expect(views).toHaveLength(0);
  });

  it('refuses to open while there is no app window', () => {
    const { service, views, closeWindow } = setup();
    closeWindow();
    expect(service.open('71273', CANVAS_A, BOUNDS)).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(views).toHaveLength(0);
  });

  it('tracks sign-in state from the main frame and reports it as design:view', () => {
    const { service, views, emit } = setup();
    open(service, '71273', CANVAS_A);
    const view = views[0]!;

    view.callbacks.onNavigated('https://claude.ai/login?returnTo=%2Fdesign');
    expect(service.get('71273')).toMatchObject({ status: 'signed-out', url: 'https://claude.ai/login' });

    view.callbacks.onNavigated('https://accounts.google.com/o/oauth2/auth?code=secret');
    expect(service.get('71273')).toMatchObject({ status: 'signed-out', url: 'https://accounts.google.com/o/oauth2/auth' });

    view.callbacks.onNavigated(CANVAS_A);
    expect(service.get('71273')).toMatchObject({ status: 'signed-in', url: CANVAS_A });

    view.callbacks.onLoadFailed();
    expect(service.get('71273')?.status).toBe('load-failed');

    expect(emit).toHaveBeenLastCalledWith('design:view', { ticketId: '71273', status: 'load-failed', url: CANVAS_A, visible: true, closed: false });
    expect(JSON.stringify(emit.mock.calls)).not.toContain('secret');
  });

  it('ignores reports from a view after it was closed', () => {
    const { service, views } = setup();
    open(service, '71273', CANVAS_A);
    const stale = views[0]!;
    service.close('71273');
    open(service, '71273', CANVAS_A);

    stale.callbacks.onNavigated('https://claude.ai/login');
    expect(service.get('71273')?.status).toBe('loading');
  });

  it('answers false for tickets without a live view', () => {
    const { service } = setup();
    expect(service.hide('nope')).toBe(false);
    expect(service.setBounds('nope', BOUNDS)).toBe(false);
    expect(service.close('nope')).toBe(false);
    expect(service.get('nope')).toBeUndefined();
  });

  it('closes every view and flushes the sign-in cookies on dispose', async () => {
    const { service, views, platform } = setup();
    open(service, '1', CANVAS_A);
    open(service, '2', CANVAS_B);

    await service.dispose();

    expect(views.every((view) => view.destroyed)).toBe(true);
    expect(service.list()).toEqual([]);
    expect(platform.flush).toHaveBeenCalledTimes(1);
  });

  it('does not touch the design partition on dispose when no view was ever opened', async () => {
    const { service, platform } = setup();
    await service.dispose();
    expect(platform.flush).not.toHaveBeenCalled();
  });

  it('reloads the page the view shows now, or the canvas before any page loaded (AL-192)', () => {
    const { service, views, emit } = setup();
    expect(service.reload('71273')).toBe(false);

    open(service, '71273', CANVAS_A);
    expect(service.reload('71273')).toBe(true);
    expect(views[0]?.loads).toEqual([CANVAS_A, CANVAS_A]);

    views[0]?.callbacks.onNavigated(`${CANVAS_A}#artboard-2`);
    expect(service.reload('71273')).toBe(true);
    expect(views[0]?.loads.at(-1)).toBe(`${CANVAS_A}#artboard-2`);
    expect(emit).toHaveBeenLastCalledWith('design:view', {
      ticketId: '71273',
      status: 'loading',
      url: `${CANVAS_A}#artboard-2`,
      visible: true,
      closed: false,
    });
  });
});
