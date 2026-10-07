import { useRef, type ReactNode } from 'react';
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
import { color, minTarget, radius, selection, space, tone, type Tone } from '@agent-lanes/tokens';
import { Icon } from './Icon';
import { stepIndex } from './SegmentedControl';
import { selectionMotion } from './selectionMotion';
import { Text } from './Text';

/** A status dot after a tab's label, as on the Connections tabs (artboard 5). */
export interface TabStatus {
  /** Dot colour: the tone's strong colour, e.g. `ok` green, `attention` amber. */
  tone: Tone;
  /**
   * The word the dot stands for ("Connected", "Needs attention"). The dot only repeats it: the word
   * is part of the tab's accessible name, so the status never rests on colour alone.
   */
  label: string;
}

export interface TabItem<T extends string> {
  value: T;
  /** Visible label and accessible name, e.g. "Build log". */
  label: string;
  status?: TabStatus;
  /**
   * The tab leaves this view instead of showing a panel here, like the drill-in's "Claude Design ↗"
   * (artboard 3): it draws the trailing ↗, and arrow keys only focus it; Enter, Space or a click opens it.
   */
  opensElsewhere?: boolean;
  /** Spoken name when the visible label isn't enough. Replaces the label (and the status word). */
  accessibilityLabel?: string;
  disabled?: boolean;
}

export interface TabsProps<T extends string> {
  tabs: readonly TabItem<T>[];
  /** The selected tab's value. */
  value: T;
  /** Called with the newly selected value on click, Enter, Space or arrow key. The tabs are controlled. */
  onChange: (value: T) => void;
  /** Accessible name of the tab list, e.g. "Connection type". */
  label: string;
  /**
   * Links each tab to its `TabPanel` (`id`, `aria-controls`, `aria-labelledby`). Pass the same value
   * (e.g. from `useId()`) to the `TabPanel` that shows the selected tab's content.
   */
  idPrefix?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The `id` of a tab, for linking from outside. */
export function tabId(idPrefix: string, value: string): string {
  return `${idPrefix}-tab-${value}`;
}

/** The `id` of the panel a tab controls. */
export function tabPanelId(idPrefix: string, value: string): string {
  return `${idPrefix}-panel-${value}`;
}

/** React Native types only declare `pressed`; react-native-web also reports hover. */
type WebPressableState = PressableStateCallbackType & { hovered?: boolean };

/** Keys that move between tabs in a horizontal tab list (WAI-ARIA tabs pattern), and which way. */
const steps: Record<string, 'previous' | 'next' | 'first' | 'last'> = {
  ArrowLeft: 'previous',
  ArrowRight: 'next',
  Home: 'first',
  End: 'last',
};

/**
 * Pill tab bar (design §11 Tabs): the drill-in's Output / Diff / Build log / ADO / Claude Design ↗
 * (artboard 3) and the Connections modal's Azure DevOps / Claude / MCP servers with status dots
 * (artboard 5). The selected tab is a raised white thumb on a grey track, as in SegmentedControl.
 *
 * A `tablist` of `tab`s with a roving tab stop: Tab reaches the selected tab; Left/Right (wrapping)
 * and Home/End move focus and select as they go, skipping disabled tabs; Enter or Space selects the
 * focused tab. Each tab is a full 44 px target.
 */
export function Tabs<T extends string>({ tabs, value, onChange, label, idPrefix, style, testID }: TabsProps<T>) {
  const tabRefs = useRef<(PressableInstance | null)[]>([]);
  const enabled = tabs.map((tab) => !tab.disabled);
  const selectedIndex = tabs.findIndex((tab) => tab.value === value);
  // The one Tab stop: the selected tab, or the first enabled one when nothing usable is selected.
  const tabStop = selectedIndex >= 0 && enabled[selectedIndex] ? selectedIndex : enabled.indexOf(true);

  const select = (index: number) => {
    const tab = tabs[index];
    if (!tab || !enabled[index]) return;
    if (tab.value !== value) onChange(tab.value);
  };

  const onKeyDown = (index: number, event: KeyDownEvent) => {
    const key = event.nativeEvent.key;
    if (key === ' ') {
      // Space selects (react-native-web only presses on Space for buttons) and must not scroll.
      event.preventDefault();
      if (!event.nativeEvent.repeat) select(index);
      return;
    }
    const step = steps[key];
    if (!step) return;
    event.preventDefault();
    const next = stepIndex(enabled, index, step);
    if (next < 0) return;
    tabRefs.current[next]?.focus();
    // Selection follows focus, except onto a tab that would leave the view.
    if (!tabs[next]?.opensElsewhere) select(next);
  };

  return (
    <View testID={testID} role="tablist" aria-label={label} style={[styles.track, style]}>
      {tabs.map((tab, index) => {
        const selected = index === selectedIndex;
        const disabled = !enabled[index];
        const name = tab.accessibilityLabel ?? (tab.status ? `${tab.label}, ${tab.status.label}` : undefined);
        return (
          <Pressable
            key={tab.value}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            testID={testID ? `${testID}-${tab.value}` : undefined}
            id={idPrefix ? tabId(idPrefix, tab.value) : undefined}
            role="tab"
            aria-selected={selected}
            aria-controls={idPrefix && selected ? tabPanelId(idPrefix, tab.value) : undefined}
            aria-label={name}
            disabled={disabled}
            tabIndex={index === tabStop ? 0 : -1}
            onPress={() => select(index)}
            onKeyDown={(event) => onKeyDown(index, event)}
            style={[styles.slot, disabled && styles.disabled, focusRingInside]}
          >
            {(state) => {
              const { hovered } = state as WebPressableState;
              const ink = selected || (hovered === true && !disabled) ? color.ink : selection.label;
              return (
                <View
                  testID={testID ? `${testID}-${tab.value}-thumb` : undefined}
                  style={[styles.thumb, selected && styles.thumbSelected, selectionMotion.segment]}
                >
                  <Text variant="title" color={ink} numberOfLines={1}>
                    {tab.label}
                  </Text>
                  {tab.status ? (
                    <View
                      testID={testID ? `${testID}-${tab.value}-dot` : undefined}
                      aria-hidden
                      style={[styles.dot, dotStyles[tab.status.tone]]}
                    />
                  ) : null}
                  {tab.opensElsewhere ? <Icon name="arrow-up-right" color={ink} size={arrowSize} /> : null}
                </View>
              );
            }}
          </Pressable>
        );
      })}
    </View>
  );
}

export interface TabPanelProps<T extends string> {
  /** The `idPrefix` given to the `Tabs`. */
  idPrefix: string;
  /** The tab whose content this is, normally the selected value. */
  value: T;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The content shown for the selected tab: a `tabpanel` named by its tab. */
export function TabPanel<T extends string>({ idPrefix, value, children, style, testID }: TabPanelProps<T>) {
  return (
    <View
      testID={testID}
      id={tabPanelId(idPrefix, value)}
      role="tabpanel"
      aria-labelledby={tabId(idPrefix, value)}
      style={style}
    >
      {children}
    </View>
  );
}

/** Track and thumb as in SegmentedControl (artboards 3 and 5): a 4 px inset, 14 px label sides. */
const thumbInset = 4;
/** Status dots on artboard 5 are 7 px, 8 px after the label; the ↗ glyph matches the 14 px label. */
const dotSize = 7;
const arrowSize = 14;

/**
 * The app's focus ring (`:focus-visible`, offset 2 px) would draw around the whole 44 px slot; pulled
 * 2 px in, it rings the visible thumb. A plain object so react-native-web inlines it over the global rule.
 */
const focusRingInside: ViewStyle = { outlineOffset: -2 };

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderRadius: radius.control,
    backgroundColor: selection.track,
  },
  slot: {
    minHeight: minTarget,
    padding: thumbInset,
    borderRadius: radius.control,
  },
  thumb: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: 14,
    borderRadius: radius.chip,
  },
  thumbSelected: {
    backgroundColor: color.surface,
    boxShadow: selection.thumbShadow,
  },
  dot: {
    width: dotSize,
    height: dotSize,
    borderRadius: dotSize / 2,
  },
  disabled: {
    opacity: selection.disabledOpacity,
  },
});

const dotStyles = StyleSheet.create(
  Object.fromEntries((Object.keys(tone) as Tone[]).map((name) => [name, { backgroundColor: tone[name].dot }])) as Record<
    Tone,
    ViewStyle
  >,
);
