import type { ViewStyle } from 'react-native';

/**
 * Platform pieces of pressable feedback, shared by Button and later controls. This is the native
 * version; interaction.web.ts replaces it in Electron and in the jsdom tests.
 */

/**
 * Whether a control that just took focus should show the focus ring. Native focus only comes
 * from a keyboard, remote or switch device, so always.
 */
export function isFocusVisible(): boolean {
  return true;
}

/** Eases the hover lift, its shadow and the pressed darkening. Native styles have no CSS transitions. */
export const liftTransition: ViewStyle = {};
