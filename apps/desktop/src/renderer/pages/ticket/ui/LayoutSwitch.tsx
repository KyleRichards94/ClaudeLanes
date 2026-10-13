import type { ReactNode } from 'react';
import type { CodeCityPanelProps } from './CodeCityPanel';

export interface LayoutSwitchProps {
  /** The Flight deck body: the layout every native build shows. */
  flightDeck: ReactNode;
  /** What Code City needs from the page: the ticket, its second agents and the composer and worktree it embeds. */
  codeCity: CodeCityPanelProps;
  /** The window is too narrow for the rail beside the transcript (the page scrolls as a whole). */
  stacked?: boolean;
}

/**
 * The ticket page's body under the header (AL-275). Code City needs CSS 3D transforms, so a native target
 * always shows Flight deck; `LayoutSwitch.web.tsx` swaps between the two layouts.
 */
export function LayoutSwitch({ flightDeck }: LayoutSwitchProps) {
  return <>{flightDeck}</>;
}
