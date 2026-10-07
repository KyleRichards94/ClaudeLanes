import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { watchWindowVisibility, type VisibilityWindow } from './window-visibility';

class FakeWindow extends EventEmitter implements VisibilityWindow {
  minimized = false;
  visible = true;
  isMinimized() {
    return this.minimized;
  }
  isVisible() {
    return this.visible;
  }
}

describe('watchWindowVisibility (AL-066)', () => {
  it('emits app:window when the window is minimised, hidden, restored or shown, once per change', () => {
    const window = new FakeWindow();
    const emit = vi.fn();
    const stop = watchWindowVisibility(window, emit, () => 42);

    window.minimized = true;
    window.emit('minimize');
    window.minimized = false;
    window.emit('restore');
    window.visible = false;
    window.emit('hide');
    window.emit('hide');
    window.visible = true;
    window.emit('show');

    expect(emit.mock.calls).toEqual([
      ['app:window', { at: 42, visible: false }],
      ['app:window', { at: 42, visible: true }],
      ['app:window', { at: 42, visible: false }],
      ['app:window', { at: 42, visible: true }],
    ]);

    stop();
    window.emit('hide');
    expect(emit).toHaveBeenCalledTimes(4);
    expect(window.listenerCount('minimize')).toBe(0);
  });

  it('counts a restore into a still-hidden window as not visible', () => {
    const window = new FakeWindow();
    const emit = vi.fn();
    watchWindowVisibility(window, emit, () => 1);
    window.visible = false;
    window.emit('restore');
    expect(emit).toHaveBeenCalledWith('app:window', { at: 1, visible: false });
  });
});
