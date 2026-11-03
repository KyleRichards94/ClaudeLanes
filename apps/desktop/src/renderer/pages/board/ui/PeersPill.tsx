import { Pressable, StyleSheet } from 'react-native';
import { minTarget } from '@agent-lanes/tokens';
import { Pill } from '@agent-lanes/ui';
import { peersPillView } from '@/entities/peer';
import { usePeerNetwork } from '@/shared/api';
import { HoverHint } from './HoverHint';

/**
 * The board header's Peers pill (AL-293, PL§2): "Peers · 3 online", amber when a listed peer can't be
 * reached, red when this app isn't listening. Hidden while there is no Peers connection.
 */
export function PeersPill({ onPress }: { onPress?: () => void }) {
  const network = usePeerNetwork();
  const view = peersPillView(network.data);
  if (!view) return null;
  const pill = <Pill size="md" tone={view.tone} dot={view.tone !== 'neutral'} label={view.label} testID="peers-pill" />;
  return (
    <HoverHint hint={view.hint}>
      {onPress ? (
        <Pressable role="button" aria-label={`${view.label}. ${view.hint}. Opens the rooms.`} onPress={onPress} style={styles.button} testID="open-rooms">
          {pill}
        </Pressable>
      ) : (
        pill
      )}
    </HoverHint>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: minTarget,
    justifyContent: 'center',
  },
});
