import { useEffect, useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import type { TicketSubBranch } from '@agent-lanes/contracts';
import { space } from '@agent-lanes/tokens';
import { Pill, Switch } from '@agent-lanes/ui';
import { useSessionStatus } from '@/shared/api';
import { setOutputDiffLayout, useOutputDiffLayout } from '@/shared/model';
import { recentEdits, useLiveDiff } from '../model/live-diff';
import { useNow } from '../model/use-now';
import { DiffTab } from './DiffTab';

export interface DiffPaneProps {
  ticketId: string;
  branch: string;
  subBranches: readonly TicketSubBranch[];
}

/**
 * The diff beside the output (the Output & diff view): the ticket's changes, read again as each of the
 * agent's tool calls or turns settles, with the files it just edited marked "Changed just now". With
 * Follow agent on, the pane scrolls to each file the agent edits, so the developer reads every change
 * as it lands.
 */
export function DiffPane({ ticketId, branch, subBranches }: DiffPaneProps) {
  const layout = useOutputDiffLayout();
  const live = useLiveDiff(ticketId);
  const now = useNow(10_000);
  const recent = useMemo(() => recentEdits(live.edits, now), [live.edits, now]);
  const working = useSessionStatus(ticketId).data?.state === 'running';
  const scroll = useRef<ScrollViewInstance>(null);
  const positions = useRef(new Map<string, number>());
  // The file to scroll to once its row is laid out (a new file appears only after the diff is read again).
  const pending = useRef<string | null>(null);
  const lastEdit = live.edits.at(-1);

  const scrollTo = (path: string) => {
    const y = positions.current.get(path);
    if (y === undefined) return false;
    scroll.current?.scrollTo({ y: Math.max(0, y - space.sm), animated: true });
    return true;
  };

  useEffect(() => {
    if (!layout.follow || !lastEdit) return;
    pending.current = lastEdit.path;
    if (scrollTo(lastEdit.path)) pending.current = null;
    // Only a new edit moves the pane, not a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEdit?.path, lastEdit?.at, layout.follow]);

  const onFileLayout = (path: string, y: number) => {
    positions.current.set(path, y);
    if (pending.current === path && scrollTo(path)) pending.current = null;
  };

  return (
    <ScrollView ref={scroll} style={styles.scroll} contentContainerStyle={styles.content} testID="diff-pane">
      <DiffTab
        ticketId={ticketId}
        branch={branch}
        subBranches={subBranches}
        view={layout.diffView}
        onViewChange={(diffView) => setOutputDiffLayout({ diffView })}
        recent={recent}
        onFileLayout={onFileLayout}
        toolbarExtra={
          <View style={styles.live}>
            {working ? <Pill label="Live · agent working" tone="claude" testID="diff-live" /> : null}
            <Switch label="Follow agent" value={layout.follow} onValueChange={(follow) => setOutputDiffLayout({ follow })} testID="diff-follow" />
          </View>
        }
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  content: {
    padding: space.lg,
  },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
});
