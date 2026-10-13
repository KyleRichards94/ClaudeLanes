import { useEffect } from 'react';
import { Platform } from 'react-native';
import { DEFAULT_TICKET_LAYOUT, useUiPrefs } from '@/shared/model';

/** Whether a key press is the layout shortcut, Ctrl+Shift+L. */
export function isLayoutShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>): boolean {
  return event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'l';
}

/** Flips the saved layout between Flight deck and Code City. */
export function toggleTicketLayout(): void {
  const { ticketLayout, setTicketLayout } = useUiPrefs.getState();
  setTicketLayout((ticketLayout ?? DEFAULT_TICKET_LAYOUT) === 'codeCity' ? 'flightDeck' : 'codeCity');
}

/**
 * Ctrl+Shift+L toggles the ticket layout wherever the focus is while the page is open (AL-275). It listens on
 * the window and reads the layout only when the key is pressed, so using it re-renders nothing here. Web only:
 * a native target has one layout.
 */
export function useLayoutShortcut(): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isLayoutShortcut(event)) return;
      event.preventDefault();
      toggleTicketLayout();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
