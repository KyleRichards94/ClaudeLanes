import { useRef } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type KeyDownEvent,
  type PressableInstance,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { color, minTarget, radius, selection } from '@agent-lanes/tokens';
import { selectionMotion } from './selectionMotion';
import { Text } from './Text';

export interface SegmentedOption<T extends string> {
  value: T;
  /** Visible label, e.g. "Sprint 42", "XHigh". */
  label: string;
  /** Spoken name when the visible label is abbreviated ("Med" → "Medium effort"). */
  accessibilityLabel?: string;
  disabled?: boolean;
}

/**
 * - `track`: segments on a grey track, the selected one a raised white thumb (artboard 2's work
 *   item and Effort controls, artboard 3's model switcher).
 * - `pills`: separate white pills, the selected one filled violet (artboard 3's effort pills).
 */
export type SegmentedVariant = 'track' | 'pills';

/**
 * Selected label colour on the white thumb (track variant): `claude` violet where the artboards
 * show a Claude setting (Effort, model), `ink` for neutral choices (Sprint 42 / Search / No ticket).
 */
export type SegmentedTone = 'claude' | 'ink';

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  /** The selected option's value. */
  value: T;
  /** Called with the newly selected value on press or arrow key. The control is controlled. */
  onChange: (value: T) => void;
  /** Accessible name of the radio group, e.g. "Effort". */
  label: string;
  variant?: SegmentedVariant;
  /** Track variant only; defaults to `claude`. */
  tone?: SegmentedTone;
  /** Stretch to the container with equal-width segments (Effort, model) instead of hugging the labels. */
  fill?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** React Native types only declare `pressed`; react-native-web also reports hover. */
type WebPressableState = PressableStateCallbackType & { hovered?: boolean };

/** Keys that move the selection (WAI-ARIA radio group pattern), and which way. */
const steps: Record<string, 'previous' | 'next' | 'first' | 'last'> = {
  ArrowLeft: 'previous',
  ArrowUp: 'previous',
  ArrowRight: 'next',
  ArrowDown: 'next',
  Home: 'first',
  End: 'last',
};

/**
 * Index of the enabled option one step from `from` (wrapping at either end), or the first or last
 * enabled option; -1 when none is enabled.
 */
export function stepIndex(enabled: readonly boolean[], from: number, step: 'previous' | 'next' | 'first' | 'last'): number {
  const count = enabled.length;
  if (step === 'first') return enabled.indexOf(true);
  if (step === 'last') return enabled.lastIndexOf(true);
  const delta = step === 'next' ? 1 : -1;
  for (let offset = 1; offset <= count; offset += 1) {
    const index = (((from + delta * offset) % count) + count) % count;
    if (enabled[index]) return index;
  }
  return -1;
}

/**
 * One choice out of a few (design §11 SegmentedControl): Sprint 42 / Search / No ticket, Effort
 * Low…Max, Opus / Sonnet / Haiku. A `radiogroup` of `radio`s with a roving tab stop: Tab reaches
 * the selected segment, arrow keys (and Home/End) move the selection and focus with it, skipping
 * disabled options. Each segment is a full 44 px target; the visible thumb sits inside it.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  variant = 'track',
  tone = 'claude',
  fill = false,
  disabled = false,
  style,
  testID,
}: SegmentedControlProps<T>) {
  const segments = useRef<(PressableInstance | null)[]>([]);
  const enabled = options.map((option) => !disabled && !option.disabled);
  const selectedIndex = options.findIndex((option) => option.value === value);
  // The one Tab stop: the selected segment, or the first enabled one when nothing usable is selected.
  const tabStop = selectedIndex >= 0 && enabled[selectedIndex] ? selectedIndex : enabled.indexOf(true);

  const select = (index: number) => {
    const option = options[index];
    if (!option || !enabled[index]) return;
    if (option.value !== value) onChange(option.value);
  };

  const onKeyDown = (index: number, event: KeyDownEvent) => {
    const key = event.nativeEvent.key;
    if (key === ' ') {
      // Space checks the focused radio (and must not scroll the page).
      event.preventDefault();
      select(index);
      return;
    }
    const step = steps[key];
    if (!step || disabled) return;
    event.preventDefault();
    const next = stepIndex(enabled, index, step);
    if (next < 0) return;
    select(next);
    segments.current[next]?.focus();
  };

  const pills = variant === 'pills';

  return (
    <View
      testID={testID}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      style={[pills ? styles.pillRow : styles.track, !fill && styles.hug, disabled && styles.disabled, style]}
    >
      {options.map((option, index) => {
        const selected = index === selectedIndex;
        const optionDisabled = !enabled[index];
        return (
          <Pressable
            key={option.value}
            ref={(node) => {
              segments.current[index] = node;
            }}
            testID={testID ? `${testID}-${option.value}` : undefined}
            role="radio"
            aria-checked={selected}
            aria-label={option.accessibilityLabel}
            disabled={optionDisabled}
            tabIndex={index === tabStop ? 0 : -1}
            onPress={() => select(index)}
            onKeyDown={(event) => onKeyDown(index, event)}
            style={[
              pills ? styles.pillSlot : styles.segmentSlot,
              fill && styles.fill,
              option.disabled && !disabled && styles.disabled,
              focusRingInside,
            ]}
          >
            {(state) => {
              const { hovered } = state as WebPressableState;
              return (
                <View
                  testID={testID ? `${testID}-${option.value}-thumb` : undefined}
                  style={[
                    pills ? styles.pill : styles.thumb,
                    selected && (pills ? styles.pillSelected : styles.thumbSelected),
                    selectionMotion.segment,
                  ]}
                >
                  <Text
                    variant={labelVariant(variant, selected)}
                    color={labelColor(variant, tone, selected, hovered === true && !optionDisabled)}
                    numberOfLines={1}
                  >
                    {option.label}
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

/**
 * Track labels are semibold in every state on artboards 2 and 3 (600 isn't bundled, so 700), so
 * selecting a segment never reflows its neighbours; effort pills go from 500 to bold when picked.
 */
function labelVariant(variant: SegmentedVariant, selected: boolean): 'title' | 'body' {
  return variant === 'track' || selected ? 'title' : 'body';
}

function labelColor(variant: SegmentedVariant, tone: SegmentedTone, selected: boolean, hovered: boolean): string {
  if (!selected) return hovered ? color.ink : selection.label;
  if (variant === 'pills') return color.surface;
  return tone === 'claude' ? color.claudeText : color.ink;
}

/** Track padding read off artboards 2 and 3: the white thumb sits 4 px inside the grey track. */
const thumbInset = 4;
/** Effort pills on artboard 3 are 34 px tall with 6 px between them. */
const pillHeight = 34;
const pillGap = 6;

/**
 * The app's focus ring (`:focus-visible`, 2 px violet, offset 2 px) would draw around the whole
 * 44 px slot, outside the track. Pulled 2 px in, it rings the visible thumb with the usual 2 px
 * gap. Kept out of StyleSheet.create on purpose: react-native-web renders plain objects as inline
 * styles, which beat the global stylesheet's outline-offset.
 */
const focusRingInside: ViewStyle = { outlineOffset: -2 };

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: radius.control,
    backgroundColor: selection.track,
  },
  pillRow: {
    flexDirection: 'row',
    // Each pill's slot pads it by half the gap; pull the row out so the outer pills line up with
    // the content edge, as the track above them does on artboard 3.
    marginHorizontal: -pillGap / 2,
  },
  hug: {
    alignSelf: 'flex-start',
  },
  fill: {
    flexGrow: 1,
    flexBasis: 0,
  },
  segmentSlot: {
    minHeight: minTarget,
    padding: thumbInset,
    // Rounds the focus ring to follow the thumb (outlines follow border-radius).
    borderRadius: radius.control,
  },
  pillSlot: {
    minHeight: minTarget,
    justifyContent: 'center',
    paddingHorizontal: pillGap / 2,
    borderRadius: radius.pill,
  },
  thumb: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radius.chip,
  },
  thumbSelected: {
    backgroundColor: color.surface,
    boxShadow: selection.thumbShadow,
  },
  pill: {
    height: pillHeight,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  pillSelected: {
    borderColor: color.claude,
    backgroundColor: color.claude,
    boxShadow: selection.pillShadow,
  },
  disabled: {
    opacity: selection.disabledOpacity,
  },
});
