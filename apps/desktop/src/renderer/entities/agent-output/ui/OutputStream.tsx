import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { space } from '@agent-lanes/tokens';
import { Button, Text } from '@agent-lanes/ui';
import { useAgentOutput } from '../model/hooks';
import { expandRow } from '../model/expanded';
import { findToolUse, outputRows, type OutputRow } from '../model/rows';
import { clearOutputScroll, useOutputScrollRequest } from '../model/scroll-request';
import type { AgentOutputStore } from '../model/store';
import { rowOffsets, windowFor } from '../model/virtual';
import { OutputRowView } from './OutputRowView';

/** Where the tool row a permission request waits on is (AL-260): not drawn yet, in view, or scrolled away. */
export type WaitingRowState = 'absent' | 'visible' | 'hidden';

export interface OutputStreamProps {
  ticketId: string;
  /** For tests and the component gallery; the app uses its store. */
  store?: AgentOutputStore;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** The tool use a permission request waits on (AL-260): its row is marked and gets `renderWaitingRow` under it. */
  waitingToolUseId?: string | null;
  /** What to draw under the waiting row: the permission prompt. */
  renderWaitingRow?: (row: Extract<OutputRow, { type: 'tool' }>) => ReactNode;
  /** Told whenever the waiting row's state changes, so the page can keep a compact prompt at the top while it is scrolled away. */
  onWaitingRow?: (state: WaitingRowState) => void;
}

/** Viewport assumed before the first layout (and in tests, where layout never comes). */
const FALLBACK_VIEWPORT = 560;
/** Within this distance of the end the view counts as following the newest output. */
const TAIL_SLACK = 24;
/** Space above the first row and below the last. */
const PAD_Y = space.lg;

/**
 * The drill-in's Output tab (AL-175, artboard 3 Output, design §12 Performance): the lead agent's
 * output as system lines, tool rows, prose and the line being written, oldest at the top.
 *
 * - Virtualised: only rows in and near the view are drawn, between two spacers, so 10,000 events
 *   draw a few dozen rows at any scroll position. Output reaches the store at most once per frame
 *   (the event hub batches `agent:output`), so the list re-renders at most once per frame.
 * - Follows the newest output; scrolling up stops following and shows "Jump to latest", and
 *   scrolling back to the end (or the button) follows again.
 * - Rows are in normal flow inside one scroll view, so text can be selected across rows and copied.
 */
export function OutputStream({ ticketId, store, style, testID = 'output-stream', waitingToolUseId = null, renderWaitingRow, onWaitingRow }: OutputStreamProps) {
  const events = useAgentOutput(ticketId, store);
  const rows = outputRows(events);
  const scrollRef = useRef<ScrollViewInstance>(null);
  // Heights of rows drawn so far, by row key; a new map on each change so the offsets follow it.
  const [measured, setMeasured] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [follow, setFollow] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState({ width: 0, height: FALLBACK_VIEWPORT });

  const offsets = rowOffsets(rows, measured, viewport.width > 0 ? viewport.width - 2 * space.xl : undefined);
  const total = offsets[rows.length] ?? 0;
  const tailTop = Math.max(total + 2 * PAD_Y - viewport.height, 0);
  // While following, the view sits at the newest output whatever the last scroll event said.
  const top = follow ? tailTop : scrollTop;
  const { start, end } = windowFor(offsets, rows.length, top - PAD_Y, viewport.height);

  // New output (or turning follow back on) keeps the newest row in view.
  useLayoutEffect(() => {
    if (follow) scrollRef.current?.scrollToEnd({ animated: false });
  }, [follow, tailTop]);

  // A sub-agent card asked for its Spawn row (AL-261): open it and scroll there once the stream has it.
  const scrollRequest = useOutputScrollRequest(ticketId);
  useLayoutEffect(() => {
    if (scrollRequest === null) return;
    const target = findToolUse(rows, scrollRequest);
    if (!target) return;
    for (const key of target.expandKeys) expandRow(ticketId, key);
    clearOutputScroll(ticketId);
    const y = Math.max((offsets[target.index] ?? 0) + PAD_Y - space.md, 0);
    // After this layout pass the view stops following the newest output and moves to the row.
    queueMicrotask(() => {
      setFollow(false);
      setScrollTop(y);
      scrollRef.current?.scrollTo({ y, animated: true });
    });
  }, [scrollRequest, ticketId, rows, offsets]);

  // The row a permission request waits on (AL-260), and whether it is in view.
  const waitingIndex = waitingToolUseId === null ? -1 : rows.findIndex((row) => row.type === 'tool' && row.toolUseIds.includes(waitingToolUseId));
  const waitingState: WaitingRowState =
    waitingIndex === -1
      ? 'absent'
      : (offsets[waitingIndex] ?? 0) < top - PAD_Y + viewport.height && (offsets[waitingIndex + 1] ?? 0) > top - PAD_Y
        ? 'visible'
        : 'hidden';
  useEffect(() => {
    onWaitingRow?.(waitingState);
  }, [onWaitingRow, waitingState]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    const height = layoutMeasurement.height > 0 ? layoutMeasurement.height : viewport.height;
    const content = contentSize.height > 0 ? contentSize.height : total + 2 * PAD_Y;
    setScrollTop(contentOffset.y);
    const atTail = contentOffset.y + height >= content - TAIL_SLACK;
    if (follow !== atTail && content > height) setFollow(atTail);
  };

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (height > 0 && (height !== viewport.height || width !== viewport.width)) setViewport({ width, height });
  };

  const onRowLayout = (key: string, height: number) => {
    setMeasured((heights) => {
      if (height <= 0 || Math.abs((heights.get(key) ?? -1) - height) < 0.5) return heights;
      const next = new Map(heights);
      next.set(key, height);
      return next;
    });
  };

  const jumpToLatest = () => {
    setFollow(true);
    scrollRef.current?.scrollToEnd({ animated: false });
  };

  const drawn: ReactNode[] = [];
  for (let index = start; index < end; index++) {
    const row = rows[index]!;
    const waiting = index === waitingIndex;
    drawn.push(
      <View key={row.key} onLayout={(event) => onRowLayout(row.key, event.nativeEvent.layout.height)}>
        <OutputRowView row={row} ticketId={ticketId} waiting={waiting} />
        {waiting && row.type === 'tool' ? renderWaitingRow?.(row) : null}
      </View>,
    );
  }

  return (
    <View style={[styles.frame, style]} testID={testID}>
      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Text variant="meta" size="md">
            {"The agent's output streams here: tool calls, its notes and the line it is writing now."}
          </Text>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.content}
          onScroll={onScroll}
          onLayout={onLayout}
          scrollEventThrottle={16}
          role="log"
          aria-label="Agent output"
          testID={`${testID}-scroll`}
        >
          <View style={{ height: offsets[start] ?? 0 }} testID={`${testID}-above`} />
          {drawn}
          <View style={{ height: Math.max(total - (offsets[end] ?? total), 0) }} testID={`${testID}-below`} />
        </ScrollView>
      )}
      {!follow ? (
        <View style={styles.jump} pointerEvents="box-none">
          <Button size="sm" variant="primary" label="Jump to latest" icon="chevron-down" onPress={jumpToLatest} testID="output-jump-latest" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingVertical: PAD_Y,
    paddingHorizontal: space.xl,
  },
  empty: {
    flex: 1,
    padding: space.xl,
  },
  jump: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: space.lg,
    alignItems: 'center',
  },
});
