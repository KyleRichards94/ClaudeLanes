import { Pressable, StyleSheet, View } from 'react-native';
import { color, minTarget, radius, space } from '@agent-lanes/tokens';
import { GlassPanel, Text } from '@agent-lanes/ui';
import { WorkItemChip } from '@/entities/ado-work-item';
import { useWorkItem } from '@/shared/api';
import { routes, useNavigation } from '@/shared/routing';

export interface TicketPageProps {
  ticketId: string;
}

/**
 * Route `ticket/:id`, the ticket drill-in (artboard 3). Only the top bar and the way into the
 * Claude Design tab so far; AL-170 builds the page frame.
 */
export function TicketPage({ ticketId }: TicketPageProps) {
  const { navigate } = useNavigation();
  // A ticket started from a work item has that item's id; a no-ticket job (`nt-…`) has none.
  const workItem = useWorkItem(/^\d+$/.test(ticketId) ? Number(ticketId) : null);

  return (
    <View style={styles.page} testID="ticket-page">
      <GlassPanel style={styles.topBar}>
        <Pressable role="button" style={styles.button} onPress={() => navigate(routes.board())}>
          <Text variant="title">← Board</Text>
        </Pressable>
        <Text variant="title" role="heading" aria-level={1}>
          #{ticketId}
        </Text>
      </GlassPanel>

      {/* The work item the ticket is for, from Azure DevOps (AL-066); AL-170 builds the full meta row. */}
      {workItem.data ? <WorkItemChip item={workItem.data} testID="ticket-work-item" /> : null}

      <View style={styles.actions}>
        <Pressable role="link" style={styles.button} onPress={() => navigate(routes.ticketDesign(ticketId))}>
          <Text variant="title">Claude Design ↗</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    padding: space.xl,
    gap: space.xl,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  button: {
    minHeight: minTarget,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  actions: {
    flexDirection: 'row',
  },
});
