import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { color, space, tone } from '@agent-lanes/tokens';
import { GlassPanel, Text } from '@agent-lanes/ui';
import { usePrefersReducedMotion } from '@/shared/lib';
import { crewStatus, type CrewTone } from '../model/cityData';
import type { CityAgent } from '../model/types';

export interface CrewPanelProps {
  agents: readonly CityAgent[];
  /** Paths in the diff: an agent on a file outside it is "Reading". */
  paths: ReadonlySet<string>;
  /** A row with an active file in the city was pressed. */
  onSelectFile(path: string): void;
}

/** Status word colours; every one is at least 4.5:1 on the glass. */
const toneColor: Record<CrewTone, string> = {
  running: color.claudeText,
  done: tone.ok.text,
  error: color.danger,
  idle: color.muted,
};

// react-native-web turns `animationKeyframes` into a CSS animation; the style types do not know it.
const pulse = {
  animationKeyframes: { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.45 } },
  animationDuration: '1.6s',
  animationIterationCount: 'infinite',
  animationTimingFunction: 'ease-in-out',
} as unknown as ViewStyle;

/** "Crew on site": every agent in the session with its model and a status word. Running rows pulse. */
export function CrewPanel({ agents, paths, onSelectFile }: CrewPanelProps) {
  const reduced = usePrefersReducedMotion();
  return (
    <GlassPanel level="md" style={styles.panel} testID="city-crew">
      <Text variant="meta" style={styles.heading}>
        Crew on site
      </Text>
      {agents.length === 0 ? <Text variant="meta">No agents yet</Text> : null}
      {agents.map((agent) => {
        const { word, tone } = crewStatus(agent, paths);
        const target = agent.status === 'running' && agent.activeFile && paths.has(agent.activeFile) ? agent.activeFile : null;
        const row = (
          <View style={[styles.row, tone === 'running' && !reduced ? pulse : null]}>
            <View style={[styles.swatch, { backgroundColor: agent.color }]} />
            <View style={styles.who}>
              <Text variant="body" size="sm" style={styles.name} numberOfLines={1}>
                {agent.name}
              </Text>
              {agent.model ? (
                <Text variant="meta" size="xs" numberOfLines={1}>
                  {agent.model}
                </Text>
              ) : null}
            </View>
            <Text variant="meta" size="sm" color={toneColor[tone]} style={styles.status}>
              {word}
            </Text>
          </View>
        );
        return target ? (
          <Pressable key={agent.id} role="button" aria-label={`${agent.name}, ${word}. Show its building`} onPress={() => onSelectFile(target)}>
            {row}
          </Pressable>
        ) : (
          <View key={agent.id}>
            {row}
          </View>
        );
      })}
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', top: 16, right: 16, minWidth: 210, padding: space.md, zIndex: 5 },
  heading: { marginBottom: 6, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 5 },
  swatch: { width: 12, height: 12, borderRadius: 4 },
  who: { flex: 1, minWidth: 0 },
  name: { fontWeight: '700' },
  status: { fontWeight: '700', textAlign: 'right' },
});
