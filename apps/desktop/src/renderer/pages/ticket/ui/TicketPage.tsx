import { Pressable, StyleSheet, View } from 'react-native';
import { color, minTarget, radius, space } from '@agent-lanes/tokens';
import { GlassPanel, Text } from '@agent-lanes/ui';
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
