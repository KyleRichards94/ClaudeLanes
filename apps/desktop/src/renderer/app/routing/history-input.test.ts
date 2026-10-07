import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installHistoryInput } from './history-input';

describe('installHistoryInput', () => {
  const history = { back: vi.fn(), forward: vi.fn() };
  let uninstall: () => void;

  beforeEach(() => {
    history.back.mockReset();
    history.forward.mockReset();
    uninstall = installHistoryInput(window, history);
  });

  afterEach(() => {
    uninstall();
    document.body.innerHTML = '';
  });

  function mouseUp(button: number, target: EventTarget = document.body) {
    const event = new MouseEvent('mouseup', { button, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  }

  function keyDown(init: KeyboardEventInit, target: EventTarget = document.body) {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  it("goes back and forward with the mouse's side buttons, and claims the event", () => {
    const backEvent = mouseUp(3);
    expect(history.back).toHaveBeenCalledTimes(1);
    expect(backEvent.defaultPrevented).toBe(true);

    mouseUp(4);
    expect(history.forward).toHaveBeenCalledTimes(1);
  });

  it('leaves the other mouse buttons alone', () => {
    for (const button of [0, 1, 2]) expect(mouseUp(button).defaultPrevented).toBe(false);
    expect(history.back).not.toHaveBeenCalled();
    expect(history.forward).not.toHaveBeenCalled();
  });

  it('goes back and forward with Alt+← and Alt+→', () => {
    expect(keyDown({ key: 'ArrowLeft', altKey: true }).defaultPrevented).toBe(true);
    expect(history.back).toHaveBeenCalledTimes(1);

    keyDown({ key: 'ArrowRight', altKey: true });
    expect(history.forward).toHaveBeenCalledTimes(1);
  });

  it('goes back and forward with the Browser Back and Forward keys', () => {
    keyDown({ key: 'BrowserBack' });
    keyDown({ key: 'BrowserForward' });
    expect(history.back).toHaveBeenCalledTimes(1);
    expect(history.forward).toHaveBeenCalledTimes(1);
  });

  it.each<KeyboardEventInit>([
    { key: 'ArrowLeft' },
    { key: 'ArrowLeft', altKey: true, ctrlKey: true },
    { key: 'ArrowLeft', altKey: true, shiftKey: true },
    { key: 'ArrowLeft', altKey: true, metaKey: true },
    { key: 'ArrowLeft', altKey: true, repeat: true },
    { key: 'ArrowUp', altKey: true },
  ])('ignores %o', (init) => {
    expect(keyDown(init).defaultPrevented).toBe(false);
    expect(history.back).not.toHaveBeenCalled();
    expect(history.forward).not.toHaveBeenCalled();
  });

  it.each(['<input />', '<textarea></textarea>', '<div contenteditable="true"><span>draft</span></div>'])(
    'leaves Alt+← to the text field %s',
    (html) => {
      document.body.innerHTML = html;
      const field = document.body.querySelector('input, textarea, span');
      if (!field) throw new Error('fixture missing');

      expect(keyDown({ key: 'ArrowLeft', altKey: true }, field).defaultPrevented).toBe(false);
      expect(history.back).not.toHaveBeenCalled();
      // The mouse button still works from inside a field.
      mouseUp(3, field);
      expect(history.back).toHaveBeenCalledTimes(1);
    },
  );

  it('lets a component that handled the input first keep it', () => {
    document.body.innerHTML = '<div id="claims"></div>';
    const claims = document.getElementById('claims');
    if (!claims) throw new Error('fixture missing');
    claims.addEventListener('mouseup', (event) => event.preventDefault());
    claims.addEventListener('keydown', (event) => event.preventDefault());

    mouseUp(3, claims);
    keyDown({ key: 'ArrowLeft', altKey: true }, claims);
    expect(history.back).not.toHaveBeenCalled();
  });

  it('stops listening once uninstalled', () => {
    uninstall();
    mouseUp(3);
    keyDown({ key: 'ArrowLeft', altKey: true });
    expect(history.back).not.toHaveBeenCalled();
  });
});
