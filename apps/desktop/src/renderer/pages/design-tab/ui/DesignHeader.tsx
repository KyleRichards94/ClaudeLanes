import { StyleSheet, View } from 'react-native';
import { space } from '@agent-lanes/tokens';
import { Button, GlassPanel, IdChip, Pill, Text } from '@agent-lanes/ui';
import { modelEffortLabel, stageProgressLabel, type AgentTicket } from '@/entities/agent-ticket';
import { routes, useNavigation } from '@/shared/routing';

/**
 * The design tab's compact ticket header (artboard 4): ← Board, #id, title, the stage pill
 * ("Implementing · 46%") and "Opus · XHigh". The ticket may still be loading (`ticket` undefined).
 */
export function DesignHeader({ ticketId, ticket }: { ticketId: string; ticket: AgentTicket | undefined }) {
  const { navigate } = useNavigation();

  return (
    <GlassPanel style={styles.bar} testID="design-header">
      <Button label="← Board" size="sm" onPress={() => navigate(routes.board())} />
      {/^\d+$/.test(ticketId) ? <IdChip id={ticketId} style={styles.idChip} /> : <Pill label={ticketId} />}
      <Text variant="title" size="lg" role="heading" aria-level={1} numberOfLines={1} style={styles.title}>
        {ticket?.title || 'Claude Design'}
      </Text>
      {ticket ? (
        <View style={styles.status}>
          <Pill tone="claude" size="md" label={stageProgressLabel(ticket.stage, ticket.progress)} testID="design-stage-pill" />
          <Text variant="meta" size="md">
            {modelEffortLabel(ticket.model, ticket.effort)}
          </Text>
        </View>
      ) : null}
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
  },
  idChip: {
    alignSelf: 'center',
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  title: {
    flex: 1,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
});
