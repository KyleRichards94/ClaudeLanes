import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { color, radius, shadow, space } from '@agent-lanes/tokens';
import { Button, Pill, Switch, Text } from '@agent-lanes/ui';
import { copyText } from '@/shared/lib';
import { useBuildLog } from '../model/hooks';
import { buildLogText, nextErrorRow } from '../model/log';
import type { BuildLogStore } from '../model/store';
import { VirtualLog, type VirtualLogHandle } from './VirtualLog';

export interface BuildLogProps {
  ticketId: string;
  /** For tests and the component gallery; the app uses its store. */
  store?: BuildLogStore;
  style?: StyleProp<ViewStyle>;
}

/** How long Copy reads "Copied" before it goes back. */
const COPIED_MS = 2_000;

function plural(count: number, word: string): string {
  return `${count.toLocaleString('en')} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * The drill-in's Build log tab (AL-135, artboard 3 tabs, design §10): the ticket's build and run
 * output in a virtualised mono log, warnings amber and errors red, with error and warning counts,
 * "Next error", Copy and a Follow tail switch. Follow is on at first; scrolling up turns it off and
 * scrolling back to the end turns it on again.
 */
export function BuildLog({ ticketId, store, style }: BuildLogProps) {
  const log = useBuildLog(ticketId, store);
  const listRef = useRef<VirtualLogHandle>(null);
  const [follow, setFollow] = useState(true);
  const [markedRow, setMarkedRow] = useState<number | null>(null);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const firstInView = useRef(0);
  const errors = log.errorRows.length;

  useEffect(() => {
    if (copied === 'idle') return;
    const timer = setTimeout(() => setCopied('idle'), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const jumpToNextError = () => {
    // From the error last jumped to while it is still in view, else from the top of the view (the
    // end of the log while following the tail, so the first error comes next).
    const from = markedRow ?? (follow ? log.rows.length - 1 : firstInView.current - 1);
    const row = nextErrorRow(log, from);
    if (row === null) return;
    setFollow(false);
    setMarkedRow(row);
    listRef.current?.scrollToRow(row);
  };

  const copy = async () => {
    setCopied((await copyText(buildLogText(log))) ? 'copied' : 'failed');
  };

  const onViewChange = (first: number, last: number) => {
    firstInView.current = first;
    // Scrolled away from the marked error: the next jump starts from the view again.
    if (markedRow !== null && (markedRow < first || markedRow > last)) setMarkedRow(null);
  };

  const copyLabel = copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy';
  const empty = log.rows.length === 0;

  return (
    <View style={[styles.panel, style]} testID="build-log">
      <View style={styles.toolbar}>
        <View style={styles.counts}>
          <Pill tone={errors > 0 ? 'danger' : 'neutral'} dot={errors > 0} label={plural(errors, 'error')} testID="build-log-errors" />
          <Pill
            tone={log.warnings > 0 ? 'attention' : 'neutral'}
            dot={log.warnings > 0}
            label={plural(log.warnings, 'warning')}
            testID="build-log-warnings"
          />
          <Text variant="meta" numberOfLines={1}>
            {log.dropped > 0 ? `Last ${plural(log.rows.length, 'line')} · older lines dropped` : plural(log.rows.length, 'line')}
          </Text>
        </View>
        <View style={styles.actions}>
          <Button size="sm" label="Next error" icon="chevron-down" disabled={errors === 0} onPress={jumpToNextError} />
          <Button size="sm" label={copyLabel} icon={copied === 'copied' ? 'check' : undefined} disabled={empty} onPress={copy} />
          <Switch label="Follow tail" value={follow} onValueChange={setFollow} style={styles.follow} testID="build-log-follow" />
        </View>
      </View>
      {empty ? (
        <View style={styles.empty}>
          <Text variant="meta">No build output yet. Build or Run streams its output here.</Text>
        </View>
      ) : (
        <VirtualLog
          handleRef={listRef}
          rows={log.rows}
          follow={follow}
          onFollowChange={setFollow}
          markedRow={markedRow}
          onViewChange={onViewChange}
          testID="build-log-lines"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    minHeight: 360,
    backgroundColor: color.surface,
    borderRadius: radius.panel,
    borderWidth: 1,
    borderColor: color.line,
    boxShadow: shadow.card,
    overflow: 'hidden',
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  counts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  follow: {
    paddingHorizontal: space.sm,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
});
