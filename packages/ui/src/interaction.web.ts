import type { ViewStyle } from 'react-native';
import { motion } from '@agent-lanes/tokens';

type Modality = 'keyboard' | 'pointer';

/** How the user last interacted with the page; null until they do. */
let lastModality: Modality | null = null;

// Capture-phase listeners see every key and pointer press before any control reacts to it.
if (typeof document !== 'undefined') {
  document.addEventListener(
    'keydown',
    (event) => {
      // Shortcuts (Ctrl+C, Alt+Tab to another window) aren't keyboard navigation.
      if (!event.ctrlKey && !event.metaKey && !event.altKey) lastModality = 'keyboard';
    },
    true,
  );
  document.addEventListener('pointerdown', () => (lastModality = 'pointer'), true);
  document.addEventListener('mousedown', () => (lastModality = 'pointer'), true);
}

/**
 * Whether a control that just took focus should show the focus ring: yes after keyboard input
 * (Tab, Shift+Tab, Esc closing a modal and returning focus), no after a mouse click, the same
 * split the browser's `:focus-visible` makes. Tracked here rather than read from
 * `:focus-visible` so jsdom tests behave like Chromium (jsdom misreads a second Tab press).
 */
export function isFocusVisible(): boolean {
  return lastModality !== 'pointer';
}

/**
 * Eases the hover lift, its deeper shadow and the pressed darkening, ease-out 220 ms (design §2
 * tokens sheet: "ease-out 150–220 ms"). CSS transitions are web-only style keys that
 * react-native-web passes through, so they sit outside the React Native style types.
 */
export const liftTransition = {
  transitionProperty: 'transform, box-shadow, filter',
  transitionDuration: `${motion.slowMs}ms`,
  transitionTimingFunction: motion.easing,
} as unknown as ViewStyle;
