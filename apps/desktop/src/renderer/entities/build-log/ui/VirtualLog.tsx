import { useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ScrollViewInstance,
  type ViewStyle,
} from 'react-native';
import { color, font, fontSize, fontWeight, space, tone } from '@agent-lanes/tokens';
import { Text } from '@agent-lanes/ui';
import type { BuildLogRow } from '../model/log';

/** Every row is one line this tall, so the window of rows to draw is arithmetic, not measured. */
export const LOG_ROW_HEIGHT = 20;
/** Rows drawn above and below the viewport, so a fast wheel never shows a blank strip. */
export const LOG_OVERSCAN = 30;
/** Viewport height assumed before the first layout (and in tests, where layout never comes). */
const FALLBACK_VIEWPORT = 480;
/** Within this distance of the end the view counts as following the tail. */
const TAIL_SLACK = LOG_ROW_HEIGHT;

export interface VirtualLogHandle {
  /** Scrolls so `row` sits a few rows below the top of the view. */
  scrollToRow(row: number): void;
  scrollToEnd(): void;
}

export interface VirtualLogProps {
  rows: readonly BuildLogRow[];
  /** Keeps the newest line in view as lines arrive. */
  follow: boolean;
  /** The user scrolled away from the tail (false) or back to it (true). */
  onFollowChange: (follow: boolean) => void;
  /** Index of a row to mark (the error "jump to next error" landed on). */
  markedRow?: number | null;
  /** Called with the first and last row in view after each scroll. */
  onViewChange?: (first: number, last: number) => void;
  handleRef?: Ref<VirtualLogHandle>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The rows to draw for a scroll position: the ones in view plus LOG_OVERSCAN either side. */
export function visibleRange(count: number, scrollTop: number, viewport: number): { start: number; end: number } {
  const first = Math.floor(Math.max(scrollTop, 0) / LOG_ROW_HEIGHT);
  const last = Math.ceil((Math.max(scrollTop, 0) + viewport) / LOG_ROW_HEIGHT);
  return { start: Math.max(first - LOG_OVERSCAN, 0), end: Math.min(last + LOG_OVERSCAN, count) };
}

/**
 * A virtualised monospace log (AL-135, design §12 Performance): a scroll area as tall as every row,
 * with only the rows in and near the view drawn, each absolutely placed at `index × LOG_ROW_HEIGHT`.
 * A 50,000-line log draws about a hundred rows at any scroll position. Lines are one row each and
 * long ones end in an ellipsis; Copy gives the full text.
 */
export function VirtualLog({ rows, follow, onFollowChange, markedRow = null, onViewChange, handleRef, style, testID }: VirtualLogProps) {
  const scrollRef = useRef<ScrollViewInstance>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(FALLBACK_VIEWPORT);
  const [viewportWidth, setViewportWidth] = useState(0);
  const contentHeight = rows.length * LOG_ROW_HEIGHT;
  const tailTop = Math.max(contentHeight - viewport, 0);
  // While following, the view sits at the tail whatever the last scroll event said.
  const top = follow ? tailTop : scrollTop;

  useImperativeHandle(handleRef, () => ({
    scrollToRow(row) {
      const y = Math.max((row - 3) * LOG_ROW_HEIGHT, 0);
      scrollRef.current?.scrollTo({ y, animated: false });
      setScrollTop(y);
    },
    scrollToEnd() {
      scrollRef.current?.scrollTo({ y: tailTop, animated: false });
      setScrollTop(tailTop);
    },
  }));

  // New lines (or turning follow on) keep the tail in view.
  useLayoutEffect(() => {
    if (follow) scrollRef.current?.scrollTo({ y: tailTop, animated: false });
  }, [follow, tailTop]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement } = event.nativeEvent;
    const top = contentOffset.y;
    const height = layoutMeasurement.height > 0 ? layoutMeasurement.height : viewport;
    setScrollTop(top);
    onViewChange?.(Math.floor(top / LOG_ROW_HEIGHT), Math.max(Math.ceil((top + height) / LOG_ROW_HEIGHT) - 1, 0));
    const atTail = top + height >= contentHeight - TAIL_SLACK;
    if (follow !== atTail && contentHeight > height) onFollowChange(atTail);
  };

  const onLayout = (event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    if (height > 0) setViewport(height);
  };
  const onWidthLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width > 0) setViewportWidth(width);
  };

  const { start, end } = visibleRange(rows.length, top, viewport);
  const drawn: ReactNode[] = [];
  for (let index = start; index < end; index++) {
    const row = rows[index]!;
    drawn.push(<LogLine key={row.id} row={row} index={index} marked={index === markedRow} />);
  }
  // Long lines scroll sideways instead of ending in an ellipsis (AL-254): the content is as wide as the longest line.
  const contentWidth = Math.max(viewportWidth, logContentWidth(rows));

  return (
    <ScrollView horizontal style={[styles.scroll, style]} contentContainerStyle={styles.across} showsHorizontalScrollIndicator onLayout={onWidthLayout}>
      <ScrollView
        ref={scrollRef}
        testID={testID}
        aria-label="Build log lines"
        style={[styles.scroll, { width: contentWidth }]}
        onScroll={onScroll}
        onLayout={onLayout}
        scrollEventThrottle={16}
      >
        <View style={[styles.content, { height: contentHeight, width: contentWidth }]}>{drawn}</View>
      </ScrollView>
    </ScrollView>
  );
}

/** Mono glyph width at the log's 12 px, with the row's side padding. */
const LOG_CHAR_PX = 7.3;
const LOG_ROW_PADDING = 2 * space.lg;

/** The width the longest line needs, so the horizontal scroll reaches its end. */
export function logContentWidth(rows: readonly BuildLogRow[]): number {
  let longest = 0;
  for (const row of rows) if (row.text.length > longest) longest = row.text.length;
  return Math.ceil(longest * LOG_CHAR_PX) + LOG_ROW_PADDING;
}

function LogLine({ row, index, marked }: { row: BuildLogRow; index: number; marked: boolean }) {
  return (
    <View
      testID={`build-log-${row.level}`}
      style={[styles.row, { top: index * LOG_ROW_HEIGHT }, washes[row.level], marked && styles.marked]}
    >
      <Text selectable numberOfLines={1} style={[styles.text, inks[row.level]]}>
        {row.text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  // The sideways scroller's content: the vertical log, as tall as the panel.
  across: {
    flexGrow: 1,
    alignItems: 'stretch',
  },
  content: {
    position: 'relative',
    minWidth: '100%',
  },
  row: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: LOG_ROW_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  text: {
    fontFamily: font.mono,
    fontWeight: fontWeight.mono,
    fontSize: fontSize.sm,
    lineHeight: LOG_ROW_HEIGHT,
  },
  marked: {
    boxShadow: `inset 3px 0 0 ${color.danger}`,
  },
});

/** Warnings amber and errors red (AL-135); the darker tone inks keep 4.5:1 on their washes. */
const inks = StyleSheet.create({
  info: { color: color.ink },
  warning: { color: tone.attention.text },
  error: { color: tone.danger.text },
  header: { color: color.muted, fontWeight: '700' },
});

const washes = StyleSheet.create({
  info: {},
  warning: { backgroundColor: tone.attention.band },
  error: { backgroundColor: tone.danger.wash },
  header: { backgroundColor: color.bg },
});
