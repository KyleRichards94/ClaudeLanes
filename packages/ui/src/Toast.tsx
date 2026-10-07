import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { glass, minTarget, radius, shadow, space, tone } from '@agent-lanes/tokens';
import { Button } from './Button';
import { GlassPanel } from './GlassPanel';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/** What kind of notice a toast is. Matches the `toast` event's tones in packages/contracts. */
export type ToastTone = 'info' | 'success' | 'warning' | 'error';

/** Every tone, for the component gallery and tests. */
export const toastTones: readonly ToastTone[] = ['info', 'success', 'warning', 'error'];

/** A button on a toast. */
export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface ToastProps {
  tone: ToastTone;
  /** What happened, in a few words: "MCP bridge lost the session". */
  title: string;
  /** One or two sentences of detail. The user can select and copy it. */
  body?: string;
  /** Buttons before Dismiss. The first is the primary (violet) one, the others are secondary. */
  actions?: readonly ToastAction[];
  /** Shows a Dismiss button after the actions. */
  onDismiss?: () => void;
  /** Layout around the toast (margins, width). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Width of the toast on artboard 6 ("Toast · error"); hosts stack toasts in a column this wide. */
export const toastWidth = 450;

/** Visible height of a small button; its pressable target is taller (`minTarget`). */
const smallButtonHeight = 38;

interface ToneSpec {
  icon: IconName;
  /** The icon's accessible name, so a screen reader hears the kind of notice, not just its colour. */
  word: string;
  tile: string;
  ink: string;
}

/**
 * Icon tile per tone: the tone's band behind its strong colour, as the red tile on artboard 6.
 * Warning takes the amber text colour, since the amber dot is under 3:1 on its band.
 */
const tones: Record<ToastTone, ToneSpec> = {
  info: { icon: 'info', word: 'Info', tile: tone.ado.band, ink: tone.ado.dot },
  success: { icon: 'check', word: 'Success', tile: tone.ok.band, ink: tone.ok.dot },
  warning: { icon: 'warning', word: 'Warning', tile: tone.attention.band, ink: tone.attention.text },
  error: { icon: 'alert', word: 'Error', tile: tone.danger.band, ink: tone.danger.dot },
};

/**
 * A notice on glass (design §11 Primitives; artboard 6 "Toast · error"): a tinted icon tile, a bold
 * title, a muted body, then the actions and Dismiss as small buttons.
 *
 * Each toast is a live region: an error is `role="alert"` (assertive, read out at once), every other
 * tone `role="status"` (polite, read when the reader is idle). The toast never takes focus.
 */
export function Toast({ tone: toneName, title, body, actions = [], onDismiss, style, testID }: ToastProps) {
  const spec = tones[toneName];
  const assertive = toneName === 'error';

  return (
    <GlassPanel level="xl" testID={testID} style={[styles.panel, style]}>
      <View
        role={assertive ? 'alert' : 'status'}
        aria-live={assertive ? 'assertive' : 'polite'}
        style={styles.row}
      >
        <View style={[styles.tile, tileStyles[toneName]]}>
          <Icon name={spec.icon} label={spec.word} color={spec.ink} size={16} />
        </View>
        <View style={styles.content}>
          <Text variant="title" numberOfLines={2}>
            {title}
          </Text>
          {body ? (
            <Text variant="meta" size="md" numberOfLines={4} selectable style={styles.body}>
              {body}
            </Text>
          ) : null}
          {actions.length > 0 || onDismiss ? (
            <View style={styles.actions}>
              {actions.map((action, index) => (
                <Button
                  key={`${index}:${action.label}`}
                  label={action.label}
                  variant={index === 0 ? 'primary' : 'secondary'}
                  size="sm"
                  onPress={action.onPress}
                />
              ))}
              {onDismiss ? <Button label="Dismiss" variant="secondary" size="sm" onPress={onDismiss} /> : null}
            </View>
          ) : null}
        </View>
      </View>
    </GlassPanel>
  );
}

/** Small buttons sit in a 44 px target with 3 px above and below the visible surface. */
const targetOverhang = (minTarget - smallButtonHeight) / 2;

/** Read off artboard 6: 450 wide, 14 px above and below, 16 px sides, 32 px tile, 12 px gap to the text. */
const styles = StyleSheet.create({
  panel: {
    width: toastWidth,
    maxWidth: '100%',
    borderRadius: radius.card,
    paddingVertical: space.md + 2,
    paddingHorizontal: space.lg,
    // The glass highlight plus the card's soft drop shadow.
    boxShadow: `${glass.highlight}, ${shadow.card}`,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  tile: {
    width: 32,
    height: 32,
    borderRadius: radius.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  body: {
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    // About 10 px from the text to the buttons' visible edge, and the panel's own padding below them.
    marginTop: 10 - targetOverhang,
    marginBottom: -targetOverhang,
  },
});

const tileStyles = StyleSheet.create(
  Object.fromEntries(toastTones.map((name) => [name, { backgroundColor: tones[name].tile }])) as Record<ToastTone, ViewStyle>,
);
