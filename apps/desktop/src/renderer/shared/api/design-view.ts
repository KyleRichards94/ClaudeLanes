import { useCallback, useEffect, useState } from 'react';
import type { DesignViewBounds } from '@agent-lanes/contracts';
import { invoke } from './ipc';

function boundsOf(element: Element): DesignViewBounds {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

/**
 * Puts the ticket's Claude Design canvas over a placeholder (AL-191). Pass the returned callback as
 * the placeholder `View`'s `ref`: while it is mounted, main shows the ticket's live view at its
 * bounds and follows it as it moves or resizes (`ResizeObserver`, window resize). Unmounting the
 * placeholder (another tab or page) hides the view; main keeps it alive, so coming back shows the
 * canvas exactly as it was (R11). Pass `url` undefined while the ticket has no canvas.
 */
export function useDesignViewSlot(ticketId: string, url: string | undefined): (node: unknown) => void {
  const [slot, setSlot] = useState<Element | null>(null);
  // react-native-web hands its host DOM element to a View's ref.
  const ref = useCallback((node: unknown) => setSlot(node instanceof Element ? node : null), []);

  useEffect(() => {
    if (!slot || !url) return;

    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void invoke('design:setBounds', { ticketId, bounds: boundsOf(slot) }));
    };

    void invoke('design:open', { ticketId, url, bounds: boundsOf(slot) });
    const observer = new ResizeObserver(follow);
    observer.observe(slot);
    window.addEventListener('resize', follow);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', follow);
      void invoke('design:hide', { ticketId });
    };
  }, [slot, ticketId, url]);

  return ref;
}
