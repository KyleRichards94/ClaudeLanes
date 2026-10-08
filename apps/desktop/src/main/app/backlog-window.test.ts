import { describe, expect, it, vi } from 'vitest';
import { createBacklogWindowController, createBacklogWindowHandlers, type BacklogWindowLike } from './backlog-window';

function fakeWindow() {
  let closed: (() => void) | undefined;
  let destroyed = false;
  const window = {
    isDestroyed: () => destroyed,
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(() => {
      destroyed = true;
      closed?.();
    }),
    once: vi.fn((_event: 'closed', listener: () => void) => {
      closed = listener;
    }),
  } satisfies BacklogWindowLike;
  return window;
}

describe('the popped-out Backlog window (AL-239, TB§5)', () => {
  it('opens one window per team, and brings it to the front when popped out again', () => {
    const windows: ReturnType<typeof fakeWindow>[] = [];
    const create = vi.fn(() => {
      const window = fakeWindow();
      windows.push(window);
      return window;
    });
    const controller = createBacklogWindowController(create);

    expect(controller.open(undefined)).toEqual({ opened: true });
    expect(create).toHaveBeenCalledWith(undefined);
    windows[0]!.isMinimized.mockReturnValue(true);
    expect(controller.open(undefined)).toEqual({ opened: false });
    expect(windows[0]!.restore).toHaveBeenCalled();
    expect(windows[0]!.focus).toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);

    // Another team replaces it.
    expect(controller.open('qa')).toEqual({ opened: true });
    expect(windows[0]!.close).toHaveBeenCalled();
    expect(create).toHaveBeenLastCalledWith('qa');
  });

  it('opens a new one after the user closed it, and closes it with the main window', () => {
    const windows: ReturnType<typeof fakeWindow>[] = [];
    const controller = createBacklogWindowController(() => {
      const window = fakeWindow();
      windows.push(window);
      return window;
    });
    controller.open(undefined);
    windows[0]!.close();
    expect(controller.open(undefined)).toEqual({ opened: true });
    expect(windows).toHaveLength(2);
    controller.close();
    expect(windows[1]!.close).toHaveBeenCalled();
  });

  it('reports, without throwing across IPC, when there is no window to pop out from', async () => {
    const handlers = createBacklogWindowHandlers({ backlogWindow: createBacklogWindowController(() => null) });
    expect(await handlers['app:popOutBacklog']({})).toMatchObject({ ok: false, code: 'INTERNAL' });
    const opened = createBacklogWindowHandlers({ backlogWindow: createBacklogWindowController(() => fakeWindow()) });
    expect(await opened['app:popOutBacklog']({ team: 'osc' })).toEqual({ ok: true, data: { opened: true } });
  });
});
