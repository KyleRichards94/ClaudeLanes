import type { StyleProp, ViewStyle } from 'react-native';
import { Tabs, type TabItem } from '@agent-lanes/ui';
import { setTicketPageTab, type TicketTab } from '@/shared/model';
import { routes, useNavigation } from '@/shared/routing';

export interface TicketTabBarProps {
  ticketId: string;
  /** The tab on screen: a drill-in tab, or `design` on the Claude Design tab page. */
  value: TicketTab;
  /** Ties the tabs to their panels (`tabPanelId(idPrefix, value)`). */
  idPrefix?: string;
  style?: StyleProp<ViewStyle>;
}

const LABELS: Record<TicketTab, string> = {
  output: 'Output',
  diff: 'Diff',
  'build-log': 'Build log',
  ado: 'ADO',
  design: 'Claude Design',
};

/**
 * Output / Diff / Build log / ADO / Claude Design (artboards 3 and 4). The first four are panels of
 * the drill-in (`ticket/:id`); Claude Design is its own route (`ticket/:id/design`), shown with ↗
 * from the drill-in. Picking a drill-in tab from the design tab goes back to the drill-in on it.
 */
export function TicketTabBar({ ticketId, value, idPrefix, style }: TicketTabBarProps) {
  const { navigate } = useNavigation();
  const onDesignPage = value === 'design';

  const tabs: TabItem<TicketTab>[] = (Object.keys(LABELS) as TicketTab[]).map((tab) => ({
    value: tab,
    label: LABELS[tab],
    opensElsewhere: tab === 'design' && !onDesignPage,
  }));

  const onChange = (tab: TicketTab) => {
    if (tab === 'design') {
      navigate(routes.ticketDesign(ticketId));
      return;
    }
    setTicketPageTab(ticketId, tab);
    if (onDesignPage) navigate(routes.ticket(ticketId));
  };

  return <Tabs tabs={tabs} value={value} onChange={onChange} label="Ticket views" idPrefix={idPrefix} style={style} testID="ticket-tabs" />;
}
