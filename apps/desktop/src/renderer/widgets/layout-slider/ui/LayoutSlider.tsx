import type { TicketLayout } from '@/shared/model';

export interface LayoutSliderProps {
  value: TicketLayout;
  onChange(layout: TicketLayout): void;
}

/**
 * The ticket layout slider (AL-275). Code City needs CSS 3D transforms, so a native target has one
 * layout (Flight deck) and no slider: this renders nothing. `LayoutSlider.web.tsx` is the control.
 */
export function LayoutSlider(_props: LayoutSliderProps) {
  return null;
}
