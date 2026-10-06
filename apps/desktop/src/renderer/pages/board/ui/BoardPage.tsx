import { StyleSheet, Text, View } from 'react-native';
import { color, font, fontSize, fontWeight, radius, space } from '@agent-lanes/tokens';
import { GlassPanel } from '@agent-lanes/ui';
import { useAppInfo } from '@/shared/api';

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
          <Text style={styles.logoGlyph}>≡</Text>
        </View>
        <Text style={styles.brand}>Agent Lanes</Text>
        <View style={styles.spacer} />
        <Text style={styles.runtime} testID="runtime-info">
          {appInfo.data
            ? `v${appInfo.data.version} · Electron ${appInfo.data.versions.electron} · ${appInfo.data.platform}`
            : appInfo.isError
              ? 'Main process unreachable'
              : 'Connecting…'}
        </Text>
      </GlassPanel>

      <Text style={styles.title} role="heading" aria-level={1}>
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
  logoGlyph: {
    color: color.surface,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.heading,
  },
  brand: {
    color: color.ink,
    fontFamily: font.sans,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.display,
  },
  spacer: {
    flex: 1,
  },
  runtime: {
    color: color.muted,
    fontFamily: font.mono,
    fontSize: fontSize.sm,
  },
  title: {
    color: color.ink,
    fontFamily: font.sans,
    fontSize: fontSize.display,
    fontWeight: fontWeight.display,
    letterSpacing: -1,
  },
});
