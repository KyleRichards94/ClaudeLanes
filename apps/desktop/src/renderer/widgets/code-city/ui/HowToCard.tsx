import { Pressable, StyleSheet, View } from 'react-native';
import { color, space } from '@agent-lanes/tokens';
import { GlassPanel, Icon, Text } from '@agent-lanes/ui';

export interface HowToCardProps {
  onDismiss(): void;
}

/** The legend at the scene's bottom left; once closed it stays closed (the caller stores `codeCityLegendDismissed`). */
export function HowToCard({ onDismiss }: HowToCardProps) {
  return (
    <GlassPanel level="md" style={styles.card} testID="city-howto">
      <View style={styles.head}>
        <Text variant="title" size="md" style={styles.title}>
          Code city
        </Text>
        <Pressable role="button" aria-label="Close the how-to card" onPress={onDismiss} style={styles.close} hitSlop={8}>
          <Icon name="close" size={14} color={color.muted} />
        </Pressable>
      </View>
      <Text variant="meta" color={color.muted}>
        Each building is a file. Height = lines added, red ground = lines removed. Districts are folders, and the colour shows which agent built it.
      </Text>
      <Text variant="meta" color={color.muted} style={styles.hint}>
        Click a building to inspect its diff.
      </Text>
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', left: 16, bottom: 16, maxWidth: 250, padding: space.md, zIndex: 5 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  title: { fontWeight: '800' },
  close: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  hint: { marginTop: 6 },
});
