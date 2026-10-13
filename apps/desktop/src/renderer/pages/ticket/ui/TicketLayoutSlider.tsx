import { useTicketLayout, useUiPrefs } from '@/shared/model';
import { LayoutSlider } from '@/widgets/layout-slider';

/**
 * The header's layout slider (AL-275), wired to the `ticketLayout` pref. It reads the layout itself, so
 * the header that holds it does not re-render when the layout changes, only this does.
 */
export function TicketLayoutSlider() {
  const layout = useTicketLayout();
  return <LayoutSlider value={layout} onChange={(next) => useUiPrefs.getState().setTicketLayout(next)} />;
}
