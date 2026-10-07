import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { color, radius, space } from '@agent-lanes/tokens';
import { Button, GlassPanel, Text } from '@agent-lanes/ui';
import { SettingsPanel } from './SettingsPanel';
import { useAppInfo } from '@/shared/api';
import { openNewTicket } from '@/shared/model';
import { useBoardTickets } from '../model/use-board-tickets';
import { BoardLanes } from './BoardLanes';
import { LiveDock } from './LiveDock';

/**
 * The agent board (artboard 1). The header is still the walking skeleton's until AL-142; the lanes
 * (AL-143) show every ticket record loaded into the agent ticket store, and the live dock (AL-145)
 * sits under them.
 */
export function BoardPage() {
  const appInfo = useAppInfo();
  useBoardTickets();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <View style={styles.page}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
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
          {/* The header menu's Settings until AL-142 builds the full header (repo dropdown included). */}
          <Button variant="secondary" size="sm" label="Settings" onPress={() => setSettingsOpen(true)} testID="open-settings" />
          <Button variant="primary" size="sm" icon="plus" label="New agent ticket" onPress={openNewTicket} testID="open-new-ticket" />
        </GlassPanel>

        <Text variant="display" role="heading" aria-level={1}>
          Agent board
        </Text>

        <BoardLanes />
      </ScrollView>
      <View style={styles.dock}>
        <LiveDock />
      </View>
      <SettingsPanel visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  // The dock stays at the bottom while the lanes scroll (artboard 1).
  dock: {
    paddingHorizontal: space.xl,
    paddingBottom: space.xl,
  },
  content: {
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
