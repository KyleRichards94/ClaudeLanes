import { MODELS, type Model } from '@agent-lanes/contracts';
import { useId, useRef } from 'react';
import { Pressable, StyleSheet, View, type KeyDownEvent, type PressableInstance, type PressableStateCallbackType, type ViewStyle } from 'react-native';
import { color, minTarget, radius, selection, space } from '@agent-lanes/tokens';
import { Text, stepIndex } from '@agent-lanes/ui';
import { MODEL_LABELS, MODEL_TAGLINES } from '@/shared/config';

export interface ModelPickerProps {
  value: Model;
  onChange: (model: Model) => void;
  testID?: string;
}

/** React Native types only declare `pressed`; react-native-web also reports hover. */
type WebPressableState = PressableStateCallbackType & { hovered?: boolean };

const steps: Record<string, 'previous' | 'next' | 'first' | 'last'> = {
  ArrowLeft: 'previous',
  ArrowUp: 'previous',
  ArrowRight: 'next',
  ArrowDown: 'next',
  Home: 'first',
  End: 'last',
};

const ALL_ENABLED = MODELS.map(() => true);

/**
 * The model cards on artboard 2: Opus "Deepest reasoning", Sonnet "Balanced", Haiku "Fast + light".
 * A radio group with one Tab stop (the selected card); arrow keys, Home and End move the selection,
 * like the SegmentedControl beside it. Each card's model maps to its SDK id through `SDK_MODEL_IDS`
 * (Decision D10).
 */
export function ModelPicker({ value, onChange, testID = 'model-picker' }: ModelPickerProps) {
  const cards = useRef<(PressableInstance | null)[]>([]);
  const idPrefix = useId();
  const selectedIndex = Math.max(0, MODELS.indexOf(value));

  const select = (index: number) => {
    const model = MODELS[index];
    if (model && model !== value) onChange(model);
  };

  const onKeyDown = (index: number, event: KeyDownEvent) => {
    const key = event.nativeEvent.key;
    if (key === ' ') {
      event.preventDefault();
      select(index);
      return;
    }
    const step = steps[key];
    if (!step) return;
    event.preventDefault();
    const next = stepIndex(ALL_ENABLED, index, step);
    select(next);
    cards.current[next]?.focus();
  };

  return (
    <View role="radiogroup" aria-label="Model" style={styles.row} testID={testID}>
      {MODELS.map((model, index) => {
        const selected = index === selectedIndex;
        const taglineId = `${idPrefix}-${model}`;
        return (
          <Pressable
            key={model}
            ref={(node) => {
              cards.current[index] = node;
            }}
            testID={`${testID}-${model}`}
            role="radio"
            aria-checked={selected}
            aria-label={MODEL_LABELS[model]}
            aria-describedby={taglineId}
            tabIndex={selected ? 0 : -1}
            onPress={() => select(index)}
            onKeyDown={(event) => onKeyDown(index, event)}
            style={[styles.slot, focusRing]}
          >
            {(state) => {
              const { hovered } = state as WebPressableState;
              return (
                <View style={[styles.card, hovered && !selected && styles.cardHovered, selected && styles.cardSelected]}>
                  <Text variant="title" size="lg" color={selected ? color.claudeText : color.ink} numberOfLines={1}>
                    {MODEL_LABELS[model]}
                  </Text>
                  <Text id={taglineId} variant="meta" size="sm" color={selected ? color.claudeText : undefined} numberOfLines={1}>
                    {MODEL_TAGLINES[model]}
                  </Text>
                </View>
              );
            }}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Rings the card itself rather than the slot around it (see SegmentedControl's `focusRingInside`). */
const focusRing: ViewStyle = { outlineOffset: 2 };

/** Read off artboard 2: three equal 64 px cards, 8 px apart, 12 px radius, violet ring when chosen. */
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space.sm,
  },
  slot: {
    flexGrow: 1,
    flexBasis: 0,
    minHeight: minTarget,
    borderRadius: radius.control,
  },
  card: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 2,
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: space.sm,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  cardHovered: {
    borderColor: selection.switchOff,
  },
  cardSelected: {
    borderColor: color.claude,
    backgroundColor: color.claudeTint,
    boxShadow: `0 0 0 3px ${color.claudeTint}`,
  },
});
