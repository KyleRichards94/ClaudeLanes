import { useCallback, useEffect, useState } from 'react';
import type { DesignViewBounds } from '@agent-lanes/contracts';
import { invoke } from './ipc';

function boundsOf(element: Element): DesignViewBounds {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

/**
 * Keeps the ticket's view over the placeholder while it is mounted: it is opened or shown at the
 * placeholder's bounds, which it then follows (`ResizeObserver`, window resize); unmounting hides it.
 * `url` mode opens that URL (`design:open`); `canvas` mode opens the ticket's linked canvas where it
 * was left (`design:openCanvas`), with `key` the canvas URL. Undefined `key` shows nothing.
 */
function useViewSlot(ticketId: string, mode: 'url' | 'canvas', key: string | undefined): (node: unknown) => void {
  const [slot, setSlot] = useState<Element | null>(null);
  // react-native-web hands its host DOM element to a View's ref.
  const ref = useCallback((node: unknown) => setSlot(node instanceof Element ? node : null), []);

  useEffect(() => {
    if (!slot || !key) return;

    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void invoke('design:setBounds', { ticketId, bounds: boundsOf(slot) }));
    };

    const bounds = boundsOf(slot);
    void (mode === 'url' ? invoke('design:open', { ticketId, url: key, bounds }) : invoke('design:openCanvas', { ticketId, bounds }));
    const observer = new ResizeObserver(follow);
    observer.observe(slot);
    window.addEventListener('resize', follow);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', follow);
      void invoke('design:hide', { ticketId });
    };
  }, [slot, ticketId, mode, key]);

  return ref;
}

/**
 * Puts the ticket's Claude Design canvas over a placeholder (AL-191). Pass the returned callback as
 * the placeholder `View`'s `ref`: while it is mounted, main shows the ticket's live view at its
 * bounds and follows it as it moves or resizes (`ResizeObserver`, window resize). Unmounting the
 * placeholder (another tab or page) hides the view; main keeps it alive, so coming back shows the
 * canvas exactly as it was (R11). Pass `url` undefined while the ticket has no canvas.
 */
export function useDesignViewSlot(ticketId: string, url: string | undefined): (node: unknown) => void {
  return useViewSlot(ticketId, 'url', url);
}

/**
 * Like `useDesignViewSlot`, for the ticket's linked canvas (AL-193): main picks the URL, so a live view
 * is shown as it is and a new one opens on the page the canvas was last left on, even after a
 * restart. Pass the linked canvas's URL as `canvasUrl` (a relink opens the new canvas), or undefined.
 */
export function useDesignCanvasSlot(ticketId: string, canvasUrl: string | undefined): (node: unknown) => void {
  return useViewSlot(ticketId, 'canvas', canvasUrl);
}
