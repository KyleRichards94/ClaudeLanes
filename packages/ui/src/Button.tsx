import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { color, control, focusRing, minTarget, motion, radius, shadow, space, tone } from '@agent-lanes/tokens';
import { Icon, IconProvider, type IconName } from './Icon';
import { Text, type TextSize } from './Text';
import { isFocusVisible, liftTransition } from './interaction';

/**
 * Button styles from the "Design tokens" artboard (docs/design/screens/07-design-tokens.png):
 * - `primary`: Claude violet with a violet glow. One per surface: New agent ticket, Run, Send.
 * - `strong`: ink. Weighty actions that aren't the main one: Merge worktree → main.
 * - `secondary`: white with a line border. Cancel, Build, Stop, icon buttons.
 * - `soft`: Claude tint pill. Light actions next to agent content.
 * - `danger`: white with a red border and label, for destructive actions (Remove on the
 *   Connections artboard).
 */
export type ButtonVariant = 'primary' | 'strong' | 'secondary' | 'soft' | 'danger';

/** `md` is the 44 px control on every artboard; `sm` is the 38 px row action (Replace, Remove). */
export type ButtonSize = 'sm' | 'md';

/** Every variant and size, for the component gallery and tests. */
export const buttonVariants: readonly ButtonVariant[] = ['primary', 'strong', 'secondary', 'soft', 'danger'];
export const buttonSizes: readonly ButtonSize[] = ['sm', 'md'];

/** An icon-only button must have its icon. */
type ButtonIconProps =
  | {
      /** Icon before the label, in the label's colour. */
      icon?: IconName;
      iconOnly?: false;
    }
  | {
      icon: IconName;
      /** Shows only `icon` in a square button; `label` stays the accessible name. */
      iconOnly: true;
    };

export type ButtonProps = ButtonIconProps & {
  /** The visible label, and the accessible name (also when `iconOnly` hides it). */
  label: string;
  /** Defaults to `secondary`. */
  variant?: ButtonVariant;
  /** Defaults to `md`. */
  size?: ButtonSize;
  /** Icon after the label, e.g. the arrow on "Launch agent →". Not shown when `iconOnly`. */
  trailingIcon?: IconName;
  /**
   * `center` (default) centres the content. `between` keeps the label at the start and pushes
   * `trailingIcon` to the far edge, as on the drill-in's full-width merge buttons.
   */
  justify?: 'center' | 'between';
  /**
   * Shows a spinner in the icon slot, ignores presses and sets `aria-busy`. The button keeps
   * keyboard focus, so use this (not `disabled`) while the button's own action is in flight.
   */
  loading?: boolean;
  /**
   * Blocks presses and fades the button. Rendered as a native disabled button with
   * `aria-disabled`: announced as unavailable, skipped by Tab.
   */
  disabled?: boolean;
  onPress?: () => void;
  /** Layout around the button (margins, flex, alignSelf, width). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

interface VariantSpec {
  fill: string;
  border: string;
  /** Label, icon and spinner colour. */
  ink: string;
  corner: number;
  /** Shadow at rest and under the hover lift. */
  rest: string;
  lifted: string;
}

const variants: Record<ButtonVariant, VariantSpec> = {
  primary: {
    fill: color.claude,
    border: color.claude,
    ink: color.surface,
    corner: radius.control,
    rest: control.primaryShadow,
    lifted: control.primaryShadowLifted,
  },
  strong: { fill: color.ink, border: color.ink, ink: color.surface, corner: radius.control, rest: 'none', lifted: shadow.lifted },
  secondary: { fill: color.surface, border: color.line, ink: control.ink, corner: radius.control, rest: 'none', lifted: shadow.lifted },
  soft: { fill: color.claudeTint, border: color.claudeTint, ink: color.claudeText, corner: radius.pill, rest: 'none', lifted: shadow.lifted },
  danger: { fill: color.surface, border: tone.danger.border, ink: color.danger, corner: radius.control, rest: 'none', lifted: shadow.lifted },
};

interface SizeSpec {
  /** Visible height. The pressable target is never smaller than `minTarget`. */
  height: number;
  paddingX: number;
  text: TextSize;
  icon: number;
}

/** Read off artboards 1, 3, 5 and 7: 44 px buttons with 18 px sides and 14 px labels; 38 px row actions. */
const sizes: Record<ButtonSize, SizeSpec> = {
  sm: { height: 38, paddingX: 14, text: 'sm', icon: 14 },
  md: { height: minTarget, paddingX: 18, text: 'md', icon: 16 },
};

/**
 * The app's button (design §11 Primitives). The outer element is the pressable target (at least
 * 44 × 44, design §11 accessibility) and the inner surface carries the look, so the 3 px hover
 * lift moves the surface without moving the target out from under the pointer.
 */
export function Button({
  label,
  variant = 'secondary',
  size = 'md',
  icon,
  trailingIcon,
  iconOnly = false,
  justify = 'center',
  loading = false,
  disabled = false,
  onPress,
  style,
  testID,
}: ButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [ringVisible, setRingVisible] = useState(false);
  const spec = variants[variant];
  const sizing = sizes[size];
  const blocked = disabled || loading;
  const leading = loading ? (
    <ActivityIndicator aria-hidden size={sizing.icon} color={spec.ink} />
  ) : icon ? (
    <Icon name={icon} />
  ) : null;

  return (
    <Pressable
      // react-native-web renders role="button" as a native <button type="button">, so Enter and
      // Space activate it the way the platform does, and `disabled` becomes `disabled` + aria-disabled.
      role="button"
      aria-label={iconOnly ? label : undefined}
      aria-busy={loading || undefined}
      disabled={disabled}
      // Loading only drops the handler: a native disabled button would lose keyboard focus.
      onPress={loading ? undefined : onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setRingVisible(isFocusVisible())}
      onBlur={() => setRingVisible(false)}
      testID={testID}
      style={[styles.target, suppressHostOutline, style]}
    >
      {({ pressed }) => {
        const lifted = hovered && !pressed && !blocked;
        return (
          <View
            style={[
              styles.surface,
              liftStyles.transition,
              variantStyles[variant],
              iconOnly ? iconOnlyStyles[size] : sizeStyles[size],
              justify === 'between' && styles.between,
              lifted && liftStyles.lifted,
              lifted && liftedShadows[variant],
              pressed && !blocked && liftStyles.pressed,
              disabled && liftStyles.disabled,
              ringVisible && styles.ring,
            ]}
          >
            <IconProvider color={spec.ink} size={sizing.icon}>
              <View style={styles.content}>
                {leading}
                {iconOnly ? null : (
                  <Text variant="title" size={sizing.text} color={spec.ink} numberOfLines={1} style={styles.label}>
                    {label}
                  </Text>
                )}
              </View>
              {trailingIcon && !iconOnly ? <Icon name={trailingIcon} /> : null}
            </IconProvider>
          </View>
        );
      }}
    </Pressable>
  );
}

/**
 * The ring is drawn on the surface, so the target's own outline (the app's global :focus-visible
 * rule) must stay off. An inline style, because react-native-web inserts its class rules ahead of
 * app CSS and the global rule would win over a class.
 */
const suppressHostOutline: ViewStyle = { outlineWidth: 0 };

const styles = StyleSheet.create({
  target: {
    minWidth: minTarget,
    minHeight: minTarget,
    justifyContent: 'center',
  },
  surface: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderWidth: 1,
  },
  between: {
    justifyContent: 'space-between',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexShrink: 1,
  },
  label: {
    flexShrink: 1,
  },
  ring: {
    outlineColor: focusRing.color,
    outlineWidth: focusRing.width,
    outlineOffset: focusRing.offset,
    outlineStyle: 'solid',
  },
});

/** Built once per variant and size, so react-native-web compiles each to shared CSS classes. */
const variantStyles = StyleSheet.create(
  Object.fromEntries(
    buttonVariants.map((name) => {
      const { fill, border, corner, rest } = variants[name];
      return [name, { backgroundColor: fill, borderColor: border, borderRadius: corner, boxShadow: rest }];
    }),
  ) as Record<ButtonVariant, ViewStyle>,
);
const liftedShadows = StyleSheet.create(
  Object.fromEntries(buttonVariants.map((name) => [name, { boxShadow: variants[name].lifted }])) as Record<
    ButtonVariant,
    ViewStyle
  >,
);
const sizeStyles = StyleSheet.create(
  Object.fromEntries(
    buttonSizes.map((name) => [name, { minHeight: sizes[name].height, paddingHorizontal: sizes[name].paddingX }]),
  ) as Record<ButtonSize, ViewStyle>,
);
/** Icon-only buttons are square and centred in their (possibly larger) target. */
const iconOnlyStyles = StyleSheet.create(
  Object.fromEntries(
    buttonSizes.map((name) => [name, { minHeight: sizes[name].height, width: sizes[name].height, alignSelf: 'center' }]),
  ) as Record<ButtonSize, ViewStyle>,
);

const liftStyles = StyleSheet.create({
  transition: liftTransition,
  lifted: { transform: [{ translateY: -motion.hoverLiftPx }] },
  pressed: { filter: control.pressedFilter },
  disabled: { opacity: control.disabledOpacity },
});
