import { useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { color, focusRing, space } from '@agent-lanes/tokens';

export interface SplitViewProps {
  /** `row`: side by side, the divider drags left and right; `column`: stacked, it drags up and down. */
  direction: 'row' | 'column';
  /** The first pane's share of the space, 0–1. */
  ratio: number;
  onRatioChange(ratio: number): void;
  first: ReactNode;
  /** Null shows the first pane alone, with no divider. */
  second: ReactNode | null;
  /** The divider's accessible name, e.g. "Resize output and diff". */
  label: string;
  /** Smallest share either pane keeps. */
  minRatio?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** One arrow key press moves the divider this far. */
export const SPLIT_KEY_STEP = 0.05;
const HANDLE = space.sm;
// React Native's cursor type has only auto and pointer; react-native-web passes any CSS cursor through.
const COL_RESIZE = { cursor: 'col-resize' } as unknown as ViewStyle;
const ROW_RESIZE = { cursor: 'row-resize' } as unknown as ViewStyle;

export function clampRatio(ratio: number, minRatio: number): number {
  return Math.min(1 - minRatio, Math.max(minRatio, ratio));
}

type PointerLike = { clientX?: number; clientY?: number; pageX?: number; pageY?: number; pointerId?: number };
type CaptureTarget = { setPointerCapture?(id: number): void; releasePointerCapture?(id: number): void };

/**
 * Two panes with a divider between them that the user drags, or moves with the arrow keys once it has
 * focus (a `separator` with its value as a percentage), to share the space differently.
 */
export function SplitView({ direction, ratio, onRatioChange, first, second, label, minRatio = 0.2, style, testID = 'split-view' }: SplitViewProps) {
  const [size, setSize] = useState(0);
  const [focused, setFocused] = useState(false);
  const drag = useRef<{ start: number; ratio: number } | null>(null);
  const row = direction === 'row';
  const clamped = clampRatio(ratio, minRatio);

  const onLayout = (event: LayoutChangeEvent) => setSize(row ? event.nativeEvent.layout.width : event.nativeEvent.layout.height);
  const position = (event: { nativeEvent: PointerLike }) => (row ? (event.nativeEvent.clientX ?? event.nativeEvent.pageX ?? 0) : (event.nativeEvent.clientY ?? event.nativeEvent.pageY ?? 0));

  const onPointerDown = (event: { nativeEvent: PointerLike; currentTarget: unknown }) => {
    drag.current = { start: position(event), ratio: clamped };
    const pointerId = event.nativeEvent.pointerId;
    if (pointerId !== undefined) (event.currentTarget as CaptureTarget).setPointerCapture?.(pointerId);
  };
  const onPointerMove = (event: { nativeEvent: PointerLike }) => {
    if (!drag.current || size <= 0) return;
    onRatioChange(clampRatio(drag.current.ratio + (position(event) - drag.current.start) / size, minRatio));
  };
  const onPointerUp = (event: { nativeEvent: PointerLike; currentTarget: unknown }) => {
    drag.current = null;
    const pointerId = event.nativeEvent.pointerId;
    if (pointerId !== undefined) (event.currentTarget as CaptureTarget).releasePointerCapture?.(pointerId);
  };
  const onKeyDown = (event: { nativeEvent: { key: string }; preventDefault?(): void }) => {
    const back = row ? 'ArrowLeft' : 'ArrowUp';
    const forward = row ? 'ArrowRight' : 'ArrowDown';
    const step = event.nativeEvent.key === back ? -SPLIT_KEY_STEP : event.nativeEvent.key === forward ? SPLIT_KEY_STEP : 0;
    if (step === 0) return;
    event.preventDefault?.();
    onRatioChange(clampRatio(clamped + step, minRatio));
  };

  if (second === null) {
    return (
      <View style={[styles.container, row ? styles.row : styles.column, style]} testID={testID}>
        <View style={styles.pane}>{first}</View>
      </View>
    );
  }
  return (
    <View style={[styles.container, row ? styles.row : styles.column, style]} onLayout={onLayout} testID={testID}>
      <View style={[styles.pane, { flexGrow: clamped, flexBasis: 0 }]}>{first}</View>
      <View
        role="separator"
        aria-label={label}
        aria-orientation={row ? 'vertical' : 'horizontal'}
        aria-valuenow={Math.round(clamped * 100)}
        aria-valuemin={Math.round(minRatio * 100)}
        aria-valuemax={Math.round((1 - minRatio) * 100)}
        focusable
        tabIndex={0}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown as never}
        onPointerDown={onPointerDown as never}
        onPointerMove={onPointerMove as never}
        onPointerUp={onPointerUp as never}
        onPointerCancel={onPointerUp as never}
        onResponderTerminationRequest={(_: GestureResponderEvent) => false}
        style={[styles.handle, row ? styles.handleRow : styles.handleColumn, row ? COL_RESIZE : ROW_RESIZE, focused && styles.handleFocused]}
        testID={`${testID}-divider`}
      >
        <View style={[styles.grip, row ? styles.gripRow : styles.gripColumn]} aria-hidden />
      </View>
      <View style={[styles.pane, { flexGrow: 1 - clamped, flexBasis: 0 }]}>{second}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  row: {
    flexDirection: 'row',
  },
  column: {
    flexDirection: 'column',
  },
  pane: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  handle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleRow: {
    width: HANDLE,
  },
  handleColumn: {
    height: HANDLE,
  },
  handleFocused: {
    outlineColor: focusRing.color,
    outlineWidth: focusRing.width,
    outlineStyle: 'solid',
  },
  grip: {
    borderRadius: 2,
    backgroundColor: color.line,
  },
  gripRow: {
    width: 3,
    height: 40,
  },
  gripColumn: {
    width: 40,
    height: 3,
  },
});
