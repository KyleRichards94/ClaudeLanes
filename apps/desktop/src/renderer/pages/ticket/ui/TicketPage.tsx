import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, font, fontSize, fontWeight, minTarget, radius, space } from '@agent-lanes/tokens';
import { GlassPanel } from '@agent-lanes/ui';
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
          <Text style={styles.buttonLabel}>← Board</Text>
        </Pressable>
        <Text style={styles.ticketId} role="heading" aria-level={1}>
          #{ticketId}
        </Text>
      </GlassPanel>

      <View style={styles.actions}>
        <Pressable role="link" style={styles.button} onPress={() => navigate(routes.ticketDesign(ticketId))}>
          <Text style={styles.buttonLabel}>Claude Design ↗</Text>
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
  buttonLabel: {
    color: color.ink,
    fontFamily: font.sans,
    fontSize: fontSize.md,
    fontWeight: fontWeight.heading,
  },
  ticketId: {
    color: color.ink,
    fontFamily: font.sans,
    fontSize: fontSize.md,
    fontWeight: fontWeight.heading,
  },
  actions: {
    flexDirection: 'row',
  },
});
