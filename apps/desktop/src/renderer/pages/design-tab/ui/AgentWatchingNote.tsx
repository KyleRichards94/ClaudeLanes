import { StyleSheet, View } from 'react-native';
import { isAgentWatchingDesign, type TicketDesignSpec } from '@agent-lanes/contracts';
import { color, radius, shadow, space, tone } from '@agent-lanes/tokens';
import { Text } from '@agent-lanes/ui';

/**
 * "Agent is watching this canvas" (artboard 4, AL-198): shown while the agent has fetched the latest
 * shipped spec with `get_design_spec` and not yet acknowledged it. The canvas itself is a native view
 * drawn over the page, so the note sits at the top of the side panel rather than on the canvas.
 */
export function AgentWatchingNote({ specs }: { specs: readonly TicketDesignSpec[] }) {
  const latest = specs.at(-1);
  if (!latest || !isAgentWatchingDesign(specs)) return null;
  return (
    <View style={styles.note} role="status" testID="design-agent-watching">
      <View style={styles.titleRow}>
        <View style={styles.dot} aria-hidden />
        <Text variant="title" color={color.claudeText}>
          Agent is watching this canvas
        </Text>
      </View>
      <Text variant="meta" size="md">
        {`The agent read Design v${latest.version} and is building from its artboards and tokens. It shows as Used once the agent confirms.`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    gap: space.xs,
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    boxShadow: shadow.card,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: tone.claude.dot,
  },
});
