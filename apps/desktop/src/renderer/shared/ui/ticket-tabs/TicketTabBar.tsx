import { useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Tabs, type TabItem, type TabStatus } from '@agent-lanes/ui';
import { useDesignThread } from '@/shared/api';
import { markDesignThreadSeen, setTicketPageTab, unreadDesignReplies, useDesignThreadSeenAt, type TicketTab } from '@/shared/model';
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
 * Claude Design carries a dot while the design thread has replies the user hasn't seen (AL-200).
 */
export function TicketTabBar({ ticketId, value, idPrefix, style }: TicketTabBarProps) {
  const { navigate } = useNavigation();
  const onDesignPage = value === 'design';
  const designStatus = useUnreadDesignStatus(ticketId, onDesignPage);

  const tabs: TabItem<TicketTab>[] = (Object.keys(LABELS) as TicketTab[]).map((tab) => ({
    value: tab,
    label: LABELS[tab],
    opensElsewhere: tab === 'design' && !onDesignPage,
    status: tab === 'design' ? designStatus : undefined,
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

/** "2 unread replies" on the Claude Design tab; on the design tab itself every reply is read. */
function useUnreadDesignStatus(ticketId: string, onDesignPage: boolean): TabStatus | undefined {
  // The design tab reads the thread itself; here the cached copy is enough.
  const messages = useDesignThread(ticketId, !onDesignPage).data?.messages;
  const seenAt = useDesignThreadSeenAt(ticketId);
  const newest = messages?.at(-1)?.at;

  useEffect(() => {
    if (onDesignPage && newest !== undefined) markDesignThreadSeen(ticketId, newest);
  }, [onDesignPage, newest, ticketId]);

  const unread = onDesignPage || !messages ? 0 : unreadDesignReplies(messages, seenAt);
  return unread > 0 ? { tone: 'claude', label: `${unread} unread ${unread === 1 ? 'reply' : 'replies'}` } : undefined;
}
