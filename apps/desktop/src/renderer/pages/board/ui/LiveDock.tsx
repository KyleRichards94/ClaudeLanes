import { Pressable, StyleSheet, View } from 'react-native';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { GlassPanel, Text } from '@agent-lanes/ui';
import {
  agentTickets,
  clockTime,
  useLiveFeed,
  useLiveTicketCount,
  type AgentTicketStore,
  type TicketFeedEvent,
} from '@/entities/agent-ticket';
import { useRouter, routes } from '@/shared/routing';

/**
 * The board's live dock (artboard 1, bottom bar): a `Live` pill, the latest three timestamped events
 * across tickets (amber when a ticket needs the user), and the running sub-agents and builds. It
 * re-renders at most once per animation frame however busy the tickets are. Pressing an event opens
 * its ticket.
 */
export function LiveDock({ store = agentTickets }: { store?: AgentTicketStore }) {
  const events = useLiveFeed(store);
  const subAgents = useLiveTicketCount('sub-agents-running', store);
  const builds = useLiveTicketCount('builds-running', store);
  const router = useRouter();

  return (
    <GlassPanel level="md" style={styles.dock} testID="live-dock">
      <View style={styles.live}>
        <View aria-hidden style={styles.liveDot} />
        <Text variant="title" size="sm" color={color.surface}>
          Live
        </Text>
      </View>
      <View role="log" aria-label="Latest agent events" style={styles.events}>
        {events.length === 0 ? (
          <Text variant="meta" size="sm">
            Agent events show here as they happen.
          </Text>
        ) : (
          events.map((event) => <DockEvent key={event.key} event={event} onPress={() => router.navigate(routes.ticket(event.ticketId))} />)
        )}
      </View>
      <Text variant="meta" size="sm" testID="live-dock-sub-agents">
        Sub-agents{' '}
        <Text variant="title" size="sm">
          {subAgents}
        </Text>
      </Text>
      <Text variant="meta" size="sm" testID="live-dock-builds">
        Builds{' '}
        <Text variant="title" size="sm">
          {builds}
        </Text>
      </Text>
    </GlassPanel>
  );
}

function DockEvent({ event, onPress }: { event: TicketFeedEvent; onPress: () => void }) {
  const ink = event.needsYou ? tone.attention.text : color.ink;
  const time = clockTime(event.at);
  return (
    <Pressable role="link" aria-label={`${time} ${event.ticketLabel} ${event.text}. Open ticket`} onPress={onPress} style={styles.event}>
      <Text variant="body" size="sm" numberOfLines={1} color={ink}>
        <Text variant="mono" size="sm" color={event.needsYou ? tone.attention.text : color.muted}>
          {time}
        </Text>{' '}
        {event.ticketLabel} {event.text}
      </Text>
    </Pressable>
  );
}

/** Read off artboard 1: a 50 px glass bar, 14 px from the pill to the first event, 20 px between events. */
const styles = StyleSheet.create({
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xl,
    minHeight: 50,
    paddingHorizontal: space.lg,
    paddingVertical: space.xs,
  },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: color.claude,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: tone.claude.band,
  },
  events: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xl,
    overflow: 'hidden',
  },
  event: {
    flexShrink: 1,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radius.chip,
  },
});
