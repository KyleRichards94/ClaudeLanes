import { StyleSheet, View } from 'react-native';
import { color, radius, space } from '@agent-lanes/tokens';
import { Button, GlassPanel, Text } from '@agent-lanes/ui';
import { useAppInfo } from '@/shared/api';
import { openConnections } from '@/shared/model';

/**
 * Walking-skeleton board: proves react-native-web, tokens, glass and typed IPC end to end.
 * The real header, lanes and cards arrive with AL-082 to AL-085 (docs/TICKETS.md).
 */
export function BoardPage() {
  const appInfo = useAppInfo();

  return (
    <View style={styles.page}>
      <GlassPanel style={styles.header} testID="board-header">
        <View style={styles.logo}>
          <Text variant="title" size="lg" color={color.surface}>
            ≡
          </Text>
        </View>
        <Text variant="display" size="lg">
          Agent Lanes
        </Text>
        <View style={styles.spacer} />
        {/* Selectable so the version line can be copied into a bug report. */}
        <Text variant="mono" color={color.muted} selectable testID="runtime-info">
          {appInfo.data
            ? `v${appInfo.data.version} · Electron ${appInfo.data.versions.electron} · ${appInfo.data.platform}`
            : appInfo.isError
              ? 'Main process unreachable'
              : 'Connecting…'}
        </Text>
        {/* Artboard 1's Connections icon button (AL-046); AL-142 builds the rest of the header. */}
        <Button label="Connections" icon="link" iconOnly onPress={() => openConnections()} testID="open-connections" />
      </GlassPanel>

      <Text variant="display" role="heading" aria-level={1}>
        Agent board
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    padding: space.xl,
    gap: space.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: radius.chip,
    backgroundColor: color.claude,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacer: {
    flex: 1,
  },
});
