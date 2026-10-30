import { StyleSheet, View, type ViewStyle } from 'react-native';
import { color, space } from '@agent-lanes/tokens';
import { GlassPanel, Icon, Text } from '@agent-lanes/ui';
import type { CityStage } from '../model/types';

export interface StageTrackProps {
  stages: readonly CityStage[];
}

// The --cc-* colours are set per theme in code-city.css.
const DONE = 'var(--cc-stage-done)';
const ACTIVE = color.claude;
const FUTURE = color.line;
const DONE_ROAD = 'var(--cc-road-done)';

const web = (style: Record<string, string>) => style as unknown as ViewStyle;

/** The road leaving a stop: green once the stop is done, split at the stage's progress while it is current. */
function roadStyle(stage: CityStage): ViewStyle {
  if (stage.state === 'done') return { backgroundColor: DONE_ROAD };
  if (stage.state === 'current') {
    const at = Math.round(Math.min(1, Math.max(0, stage.progress ?? 0.5)) * 100);
    return web({ backgroundImage: `linear-gradient(90deg, var(--al-claude) ${at}%, var(--al-line) ${at}%)` });
  }
  return { backgroundColor: FUTURE };
}

/** The five stages as stops joined by roads: done green, current violet with a halo, upcoming grey. */
export function StageTrack({ stages }: StageTrackProps) {
  return (
    <GlassPanel level="md" style={styles.track} testID="city-stage-track">
      {stages.map((stage, index) => {
        const current = stage.state === 'current';
        return (
          <View key={stage.id} style={[styles.cell, index < stages.length - 1 ? styles.cellGrow : null]}>
            <View style={styles.stop} accessible aria-label={`${stage.label}: ${stage.caption}${current ? ' (current stage)' : stage.state === 'done' ? ' (done)' : ''}`}>
              <View
                style={[
                  styles.square,
                  stage.state === 'done' ? { backgroundColor: DONE } : current ? { backgroundColor: ACTIVE, ...web({ boxShadow: `0 0 0 6px color-mix(in srgb, ${color.claude} 18%, transparent)` }) } : { backgroundColor: FUTURE },
                ]}
              >
                {stage.state === 'done' ? (
                  <Icon name="check" size={18} color={color.onAccent} />
                ) : (
                  <Text variant="body" size="md" color={current ? color.onAccent : color.muted} style={styles.number}>
                    {index + 1}
                  </Text>
                )}
              </View>
              <View style={styles.text}>
                <Text variant="body" size="sm" style={styles.label} numberOfLines={1}>
                  {stage.label}
                </Text>
                <Text variant="meta" size="xs" color={current ? color.claudeText : color.muted} numberOfLines={1}>
                  {stage.caption}
                </Text>
              </View>
            </View>
            {index < stages.length - 1 ? <View testID={`city-road-${stage.id}`} style={[styles.road, roadStyle(stage)]} /> : null}
          </View>
        );
      })}
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, paddingHorizontal: space.lg, borderRadius: 18 },
  cell: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  cellGrow: { flex: 1 },
  stop: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 0 },
  square: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  number: { fontWeight: '800' },
  text: { minWidth: 0, maxWidth: 110 },
  label: { fontWeight: '800' },
  road: { flex: 1, height: 8, borderRadius: 999, marginHorizontal: space.sm, minWidth: 12 },
});
