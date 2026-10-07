import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, font, fontSize, fontWeight, minTarget, radius, space } from '@agent-lanes/tokens';
import { GlassPanel } from '@agent-lanes/ui';
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
          <Text style={styles.buttonLabel}>← Board</Text>
        </Pressable>
        <View style={styles.idChip}>
          <Text style={styles.idChipLabel}>#{ticketId}</Text>
        </View>
        <Text style={styles.title} role="heading" aria-level={1}>
          Claude Design
        </Text>
      </GlassPanel>

      <View style={styles.actions}>
        <Pressable role="link" style={styles.button} onPress={() => navigate(routes.ticket(ticketId))}>
          <Text style={styles.buttonLabel}>Output</Text>
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
  idChip: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.chip,
    backgroundColor: color.adoTint,
  },
  idChipLabel: {
    color: color.ado,
    fontFamily: font.mono,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.heading,
  },
  title: {
    color: color.ink,
    fontFamily: font.sans,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.display,
  },
  actions: {
    flexDirection: 'row',
  },
});
