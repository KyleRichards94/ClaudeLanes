import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { color, radius, tone } from '@agent-lanes/tokens';
import { Text } from './Text';

/** `default` white, as on most lane headers; `attention` amber when a card in the lane needs the user. */
export type BadgeTone = 'default' | 'attention';

export interface BadgeProps {
  /** The number shown, e.g. the cards in a lane. Negative or non-finite values show as 0. */
  count: number;
  tone?: BadgeTone;
  /**
   * Accessible name, e.g. "2 tickets, 1 needs you". Defaults to the count, plus "needs you" for
   * the attention tone, so the amber never carries the meaning alone (design §11).
   */
  label?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Whole, non-negative count; anything else shows as 0. */
function shownCount(count: number): number {
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

/** A small count pill for lane headers (artboard 1). */
export function Badge({ count, tone: badgeTone = 'default', label, style, testID }: BadgeProps) {
  const shown = shownCount(count);
  const name = label ?? (badgeTone === 'attention' ? `${shown}, needs you` : String(shown));

  return (
    <View testID={testID} role="img" aria-label={name} style={[styles.badge, toneStyles[badgeTone], style]}>
      <Text variant="title" size="sm" color={textColor[badgeTone]} numberOfLines={1}>
        {shown}
      </Text>
    </View>
  );
}

/** 40 × 24 px for a single digit, read off the lane headers on artboard 1; wider counts grow it. */
const styles = StyleSheet.create({
  badge: {
    minWidth: 40,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    flexShrink: 0,
    borderRadius: radius.pill,
  },
});

const toneStyles = StyleSheet.create({
  default: { backgroundColor: color.surface },
  attention: { backgroundColor: tone.attention.band },
});

const textColor: Record<BadgeTone, string> = {
  default: tone.neutral.text,
  attention: tone.attention.text,
};
