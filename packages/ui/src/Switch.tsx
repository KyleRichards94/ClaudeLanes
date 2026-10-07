import { useId } from 'react';
import { Pressable, StyleSheet, View, type KeyDownEvent, type StyleProp, type ViewStyle } from 'react-native';
import { color, minTarget, radius, selection, space } from '@agent-lanes/tokens';
import { selectionMotion } from './selectionMotion';
import { Text } from './Text';

/** Words beside the toggle for each state, e.g. `{ on: 'Needs approval', off: 'Auto' }`. */
export interface SwitchStateText {
  on: string;
  off: string;
}

export interface SwitchProps {
  /** Row label and accessible name, e.g. "Planning". */
  label: string;
  value: boolean;
  /** Called with the new value on press, Space or Enter. The switch is controlled. */
  onValueChange: (value: boolean) => void;
  /**
   * Side text naming the current state (artboard 2's stage gates: "Needs approval" / "Auto"), so
   * the state never rests on the track colour alone. It is part of the accessible name.
   */
  stateText?: SwitchStateText;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A labelled on/off row (design §11 Switch, artboard 2's stage gates): label on the left, the
 * state's side text and a violet toggle on the right. The whole row is the `role="switch"` target
 * (≥ 44 px), exposes `aria-checked`, and toggles with Space (and Enter) or a click.
 */
export function Switch({ label, value, onValueChange, stateText, disabled = false, style, testID }: SwitchProps) {
  const labelId = useId();
  const stateId = useId();
  const sideText = stateText ? (value ? stateText.on : stateText.off) : undefined;

  const toggle = () => {
    if (!disabled) onValueChange(!value);
  };

  const onKeyDown = (event: KeyDownEvent) => {
    // react-native-web presses on Enter for any role but on Space only for buttons; a switch
    // toggles on Space (WAI-ARIA switch pattern). Holding the key down must not flicker it.
    if (event.nativeEvent.key !== ' ') return;
    event.preventDefault();
    if (!event.nativeEvent.repeat) toggle();
  };

  return (
    <Pressable
      testID={testID}
      role="switch"
      aria-checked={value}
      aria-labelledby={sideText ? `${labelId} ${stateId}` : labelId}
      disabled={disabled}
      onPress={toggle}
      onKeyDown={onKeyDown}
      style={[styles.row, disabled && styles.disabled, focusRingInside, style]}
    >
      <Text id={labelId} style={styles.label}>
        {label}
      </Text>
      {sideText ? (
        <Text id={stateId} size="sm" color={selection.label} numberOfLines={1}>
          {sideText}
        </Text>
      ) : null}
      <View
        testID={testID ? `${testID}-track` : undefined}
        style={[styles.track, value ? styles.trackOn : styles.trackOff, selectionMotion.track]}
      >
        <View
          testID={testID ? `${testID}-knob` : undefined}
          style={[styles.knob, value && styles.knobOn, selectionMotion.knob]}
        />
      </View>
    </Pressable>
  );
}

/** Stage-gate rows on artboard 2 are 48 px tall (above the 44 px minimum target) with 14 px side padding. */
const rowHeight = Math.max(48, minTarget);

/** Toggle geometry read off artboard 2: a 38 × 22 pill track with a 16 px knob 3 px inside it. */
const trackWidth = 38;
const trackHeight = 22;
const knobSize = 16;
const knobInset = (trackHeight - knobSize) / 2;
const knobTravel = trackWidth - knobSize - knobInset * 2;

/**
 * Stage-gate rows sit edge to edge in a bordered list, so the focus ring is drawn just inside the
 * row rather than over its neighbours. A plain object on purpose: react-native-web renders it as an
 * inline style, which beats the global `:focus-visible` outline-offset.
 */
const focusRingInside: ViewStyle = { outlineOffset: -2 };

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: rowHeight,
    paddingHorizontal: 14,
  },
  label: {
    flex: 1,
  },
  track: {
    width: trackWidth,
    height: trackHeight,
    borderRadius: radius.pill,
    padding: knobInset,
  },
  trackOn: {
    backgroundColor: color.claude,
  },
  trackOff: {
    backgroundColor: selection.switchOff,
  },
  knob: {
    width: knobSize,
    height: knobSize,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    boxShadow: selection.thumbShadow,
  },
  knobOn: {
    transform: [{ translateX: knobTravel }],
  },
  disabled: {
    opacity: selection.disabledOpacity,
  },
});
