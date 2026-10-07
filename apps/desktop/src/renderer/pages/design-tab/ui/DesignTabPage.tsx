import { Pressable, StyleSheet, View } from 'react-native';
import { color, minTarget, radius, space } from '@agent-lanes/tokens';
import { GlassPanel, Text } from '@agent-lanes/ui';
import { routes, useNavigation } from '@/shared/routing';

export interface DesignTabPageProps {
  ticketId: string;
}

/**
 * Route `ticket/:id/design`, the ticket's Claude Design tab (artboard 4). Only the top bar and the
 * way back to the ticket so far; AL-192 builds the page and its lazily loaded webview.
 */
export function DesignTabPage({ ticketId }: DesignTabPageProps) {
  const { navigate } = useNavigation();

  return (
    <View style={styles.page} testID="design-tab-page">
      <GlassPanel style={styles.topBar}>
        <Pressable role="button" style={styles.button} onPress={() => navigate(routes.board())}>
          <Text variant="title">← Board</Text>
        </Pressable>
        <View style={styles.idChip}>
          <Text variant="mono" color={color.ado}>#{ticketId}</Text>
        </View>
        <Text variant="display" size="lg" role="heading" aria-level={1}>
          Claude Design
        </Text>
      </GlassPanel>

      <View style={styles.actions}>
        <Pressable role="link" style={styles.button} onPress={() => navigate(routes.ticket(ticketId))}>
          <Text variant="title">Output</Text>
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
  idChip: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.chip,
    backgroundColor: color.adoTint,
  },
  actions: {
    flexDirection: 'row',
  },
});
