import { render } from '@testing-library/react';
import { View } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeBridge, type FakeBridge } from '@/shared/testing';
import { useDesignCanvasSlot, useDesignViewSlot } from './design-view';

const CANVAS = 'https://claude.ai/design/p/canvas-a';
const RECT = { left: 240, top: 120, width: 800, height: 600 };

let observers: { callback: ResizeObserverCallback; disconnected: boolean }[];

class FakeResizeObserver {
  private readonly entry: { callback: ResizeObserverCallback; disconnected: boolean };
  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, disconnected: false };
    observers.push(this.entry);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    this.entry.disconnected = true;
  }
}

function Slot({ ticketId, url }: { ticketId: string; url: string | undefined }) {
  const ref = useDesignViewSlot(ticketId, url);
  return <View ref={ref} testID="canvas-slot" />;
}

function calls(bridge: FakeBridge) {
  return vi.mocked(bridge.invoke).mock.calls.map(([channel, payload]) => [channel, payload]);
}

let bridge: FakeBridge;

beforeEach(() => {
  observers = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(RECT as DOMRect);
  const reply = { ok: true, data: { found: true } };
  bridge = installFakeBridge({
    'design:open': { ok: true, data: { ticketId: '71273', status: 'loading', url: null, visible: true } },
    'design:setBounds': reply,
    'design:hide': reply,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useDesignViewSlot', () => {
  it('opens the ticket canvas at the placeholder bounds', () => {
    render(<Slot ticketId="71273" url={CANVAS} />);

    expect(calls(bridge)).toEqual([['design:open', { ticketId: '71273', url: CANVAS, bounds: { x: 240, y: 120, width: 800, height: 600 } }]]);
  });

  it('follows the placeholder when it resizes or the window resizes', () => {
    render(<Slot ticketId="71273" url={CANVAS} />);
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ left: 0, top: 0, width: 400, height: 300 } as DOMRect);

    observers[0]?.callback([], {} as ResizeObserver);
    window.dispatchEvent(new Event('resize'));

    const bounds = { ticketId: '71273', bounds: { x: 0, y: 0, width: 400, height: 300 } };
    expect(calls(bridge).slice(1)).toEqual([
      ['design:setBounds', bounds],
      ['design:setBounds', bounds],
    ]);
  });

  it('hides the view, without closing it, when the placeholder unmounts', () => {
    const { unmount } = render(<Slot ticketId="71273" url={CANVAS} />);
    unmount();

    expect(calls(bridge).at(-1)).toEqual(['design:hide', { ticketId: '71273' }]);
    expect(calls(bridge).some(([channel]) => channel === 'design:close')).toBe(false);
    expect(observers[0]?.disconnected).toBe(true);

    window.dispatchEvent(new Event('resize'));
    expect(calls(bridge).filter(([channel]) => channel === 'design:setBounds')).toEqual([]);
  });

  it('shows nothing while the ticket has no canvas', () => {
    render(<Slot ticketId="71273" url={undefined} />);
    expect(calls(bridge)).toEqual([]);
  });
});

function CanvasSlot({ ticketId, canvasUrl }: { ticketId: string; canvasUrl: string | undefined }) {
  const ref = useDesignCanvasSlot(ticketId, canvasUrl);
  return <View ref={ref} testID="canvas-slot" />;
}

describe('useDesignCanvasSlot (AL-193)', () => {
  it("asks main to open the ticket's linked canvas, which picks the page", () => {
    const { rerender, unmount } = render(<CanvasSlot ticketId="71273" canvasUrl={CANVAS} />);
    const bounds = { x: 240, y: 120, width: 800, height: 600 };
    expect(calls(bridge)).toEqual([['design:openCanvas', { ticketId: '71273', bounds }]]);

    // A relinked canvas opens again; the same canvas does not.
    rerender(<CanvasSlot ticketId="71273" canvasUrl={CANVAS} />);
    rerender(<CanvasSlot ticketId="71273" canvasUrl="https://claude.ai/artifact/art-2" />);
    expect(calls(bridge).filter(([channel]) => channel === 'design:openCanvas')).toHaveLength(2);

    unmount();
    expect(calls(bridge).at(-1)).toEqual(['design:hide', { ticketId: '71273' }]);
  });
});
