import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, tone, type Tone } from '@agent-lanes/tokens';
import { Text } from './Text';

/**
 * Pill tint: `claude` violet (agent activity, "4 running"), `ado` blue ("Switching · next turn",
 * "Ready"), `ok` green ("Done", "MCP online"), `attention` amber ("Needs you"), `danger` red,
 * `neutral` grey ("Queued").
 */
export type PillTone = Tone;

/**
 * `sm`: 22 px, bold 12 px, the "Status badges" block on artboard 6 and status pills in cards.
 * `md`: 28 px, 14 px, the board header counts on artboard 1 ("4 running", "MCP online").
 */
export type PillSize = 'sm' | 'md';

/** Every tone, for the component gallery and tests. */
export const pillTones: readonly PillTone[] = ['claude', 'ado', 'ok', 'attention', 'danger', 'neutral'];

export interface PillProps {
  /**
   * The word or words the pill says. Required, because status is never shown by colour alone
   * (design §11): the tint and the dot only repeat what the label says.
   */
  label: string;
  /** Defaults to `neutral`. */
  tone?: PillTone;
  /** A small dot before the label in the tone's strong colour. Decorative, hidden from screen readers. */
  dot?: boolean;
  /** Defaults to `sm`. */
  size?: PillSize;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A rounded, tinted label with an optional status dot. Not interactive. */
export function Pill({ label, tone: pillTone = 'neutral', dot = false, size = 'sm', style, testID }: PillProps) {
  return (
    <View testID={testID} style={[styles.pill, sizeStyles[size], bandStyles[pillTone], style]}>
      {dot ? (
        <View testID={testID ? `${testID}-dot` : undefined} aria-hidden style={[styles.dot, dotStyles[pillTone]]} />
      ) : null}
      <Text {...labelType[size]} color={tone[pillTone].text} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Dot diameter and the gap after it, read off artboards 1 and 6. */
const dotSize = 6;

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    // Hug the label in a column, and never squeeze the word in a row.
    alignSelf: 'flex-start',
    flexShrink: 0,
    borderRadius: radius.pill,
  },
  dot: {
    width: dotSize,
    height: dotSize,
    borderRadius: dotSize / 2,
    marginRight: 6,
  },
});

/** Vertical padding plus the label's line height: 3 + 16 + 3 = 22 px (sm), 4 + 20 + 4 = 28 px (md). */
const sizeStyles = StyleSheet.create({
  sm: { paddingHorizontal: 8, paddingVertical: 3 },
  md: { paddingHorizontal: 10, paddingVertical: 4 },
});

/** Status badges are bold 12/16; header counts are 14/20 at body weight. */
const labelType = {
  sm: { variant: 'title', size: 'sm' },
  md: { variant: 'body', size: 'md' },
} as const;

const bandStyles = StyleSheet.create(
  Object.fromEntries(pillTones.map((name) => [name, { backgroundColor: tone[name].band }])) as Record<PillTone, ViewStyle>,
);

const dotStyles = StyleSheet.create(
  Object.fromEntries(pillTones.map((name) => [name, { backgroundColor: tone[name].dot }])) as Record<PillTone, ViewStyle>,
);
