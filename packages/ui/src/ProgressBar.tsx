import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { color, progressGradient, radius, tone } from '@agent-lanes/tokens';

/**
 * Fill tone, from the "Agent card states" artboard: `claude` violet→sky gradient while an agent
 * works, `ado` sky for a PR waiting on checks, `danger` red for a failed build, `ok` green once merged.
 */
export type ProgressTone = 'claude' | 'ado' | 'danger' | 'ok';

export interface ProgressBarProps {
  /** Fraction done, 0–1. Values outside the range (or NaN) are clamped. */
  progress: number;
  /** Accessible name, e.g. "Implementing progress". The bar is announced as a progressbar. */
  label: string;
  tone?: ProgressTone;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Clamp to 0–1 and convert to a whole percentage. */
export function toPercent(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.round(Math.min(1, Math.max(0, progress)) * 100);
}

/** Thin pill track with a rounded fill; status is also exposed as aria-valuenow for screen readers. */
export function ProgressBar({ progress, label, tone: fillTone = 'claude', style, testID }: ProgressBarProps) {
  const percent = toPercent(progress);

  return (
    <View
      testID={testID}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      style={[styles.track, style]}
    >
      <View
        testID={testID ? `${testID}-fill` : undefined}
        style={[styles.fill, fillStyles[fillTone], { width: `${percent}%` }]}
      />
    </View>
  );
}

/** Bar height read off artboards 1 and 6. */
const barHeight = 6;

const styles = StyleSheet.create({
  track: {
    height: barHeight,
    borderRadius: radius.pill,
    backgroundColor: color.line,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
  },
});

const fillStyles = StyleSheet.create({
  claude: {
    // Solid violet underneath in case a renderer has no gradient support.
    backgroundColor: progressGradient.from,
    backgroundImage: `linear-gradient(90deg, ${progressGradient.from}, ${progressGradient.to})`,
  },
  ado: { backgroundColor: tone.ado.fill },
  danger: { backgroundColor: tone.danger.fill },
  ok: { backgroundColor: tone.ok.fill },
});
