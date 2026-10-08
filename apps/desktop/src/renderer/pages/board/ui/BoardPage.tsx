import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from 'react-native';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Button, Text } from '@agent-lanes/ui';
import { useAgentTicketCount, useAgentTicketTotal } from '@/entities/agent-ticket';
import { DragStatusPill, DragToLaneProvider, useActiveDrag } from '@/features/drag-to-lane';
import { useLaunchFromAdo } from '@/features/launch-from-ado';
import { invoke, useAppInfo } from '@/shared/api';
import { usePrefersReducedMotion } from '@/shared/lib';
import { toast, useBoardSprint, useBoardTeam } from '@/shared/model';
import { BacklogPopout } from '@/widgets/backlog-popout';
import { TeamBoard, useTeamBoardSession } from '@/widgets/team-board';
import { isAgentBoardCollapsed, type BoardScrollMetrics } from '../model/agent-strip';
import { boardSubheader } from '../model/header';
import { STICKY_TOP_OFFSET } from '../model/sticky';
import { AgentBoardStrip } from './AgentBoardStrip';
import { useBoardTickets } from '../model/use-board-tickets';
import { BoardHeader } from './BoardHeader';
import { BoardLanes } from './BoardLanes';
import { LiveDock } from './LiveDock';
import { SettingsPanel } from './SettingsPanel';
import { StickyTop } from './StickyTop';

/**
 * The agent board (artboard 1): the header (AL-142), the sub-header, title and legend, the lanes
 * (AL-143) with every ticket record loaded into the agent ticket store, and the live dock (AL-145).
 * The header's "need you" pill narrows the lanes to the tickets waiting on the user. The team board
 * (AL-234) sits under the lanes; its cards drag onto the lanes (AL-235), which share one drag with it.
 * The header stays pinned while the page scrolls; once the lanes have scrolled away under it, they fold
 * into a strip pinned under the header, whose cells take drops too.
 */
export function BoardPage() {
  // A drop starts the agent through main (AL-236): it rechecks the card, makes the ADO change and launches.
  const launch = useLaunchFromAdo();
  const [collapsed, setCollapsed] = useState(false);
  return (
    // While the strip is pinned at the top, a card dragged up to it must not scroll the page under it.
    <DragToLaneProvider onLaunch={launch} autoScroll={!collapsed}>
      <BoardContent collapsed={collapsed} onCollapsedChange={setCollapsed} />
    </DragToLaneProvider>
  );
}

interface BoardContentProps {
  /** The lanes have scrolled away under the header and show as the strip. */
  collapsed: boolean;
  onCollapsedChange(collapsed: boolean): void;
}

function BoardContent({ collapsed, onCollapsedChange }: BoardContentProps) {
  useBoardTickets();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [needsYouOnly, setNeedsYouOnly] = useState(false);
  const [backlogOpen, setBacklogOpen] = useState(false);
  const backlogTeam = useTeamBoardSession().teamId;
  const needsYou = useAgentTicketCount('needs-you');
  const reducedMotion = usePrefersReducedMotion();

  // Where the lanes end and how far the page has scrolled, kept out of state so scrolling re-renders
  // nothing until the board collapses or expands.
  const scrollRef = useRef<ScrollViewInstance>(null);
  const metrics = useRef<BoardScrollMetrics>({ scrollY: 0, lanesBottom: null, headerBottom: null });
  const measure = useCallback(() => onCollapsedChange(isAgentBoardCollapsed(metrics.current)), [onCollapsedChange]);
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      metrics.current.scrollY = event.nativeEvent.contentOffset.y;
      measure();
    },
    [measure],
  );
  const onHeaderLayout = useCallback(
    (event: LayoutChangeEvent) => {
      metrics.current.headerBottom = STICKY_TOP_OFFSET + event.nativeEvent.layout.height;
      measure();
    },
    [measure],
  );
  const onLanesLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { y, height } = event.nativeEvent.layout;
      metrics.current.lanesBottom = y + height;
      measure();
    },
    [measure],
  );
  const expand = useCallback(() => {
    onCollapsedChange(false);
    scrollRef.current?.scrollTo({ y: 0, animated: !reducedMotion });
  }, [onCollapsedChange, reducedMotion]);

  return (
    <View style={styles.page}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        onScroll={onScroll}
        scrollEventThrottle={16}
        testID="board-scroll"
      >
        {/* Pinned while the page scrolls down to the team board; the content scrolls under its glass. */}
        <StickyTop testID="board-header-sticky" onLayout={onHeaderLayout}>
          <BoardHeader needsYouOnly={needsYouOnly} onNeedsYouOnlyChange={setNeedsYouOnly} onOpenSettings={() => setSettingsOpen(true)} />
          {/* The lanes folded into a strip under the header once they have scrolled away. */}
          <AgentBoardStrip visible={collapsed} onExpand={expand} needsYouOnly={needsYouOnly} />
        </StickyTop>

        <View style={styles.titleBlock}>
          <View style={styles.subheaderRow}>
            <BoardSubheader />
            <RuntimeInfo />
          </View>
          <View style={styles.titleRow}>
            <Text variant="display" role="heading" aria-level={1}>
              Agent board
            </Text>
            <LegendOrDragStatus />
          </View>
        </View>

        {needsYouOnly ? (
          <View style={styles.filterBar} testID="board-needs-you-filter">
            <Text variant="body" color={tone.attention.text}>
              {needsYou === 0 ? 'Nothing needs you right now.' : `Showing the ${needsYou === 1 ? 'ticket' : `${needsYou} tickets`} that need you.`}
            </Text>
            <Button size="sm" label="Show all tickets" onPress={() => setNeedsYouOnly(false)} />
          </View>
        ) : null}

        <BoardLanes needsYouOnly={needsYouOnly} onLayout={onLanesLayout} />

        {/* The team's Azure DevOps board under the agent lanes (AL-234, artboard 08). */}
        <BoardTeamBoard onOpenBacklog={() => setBacklogOpen(true)} />
      </ScrollView>
      <View style={styles.dock}>
        <LiveDock />
      </View>
      {/* The Backlog popout over the lower board; its rows drag onto the lanes above it (AL-239, TB§5). */}
      <BacklogPopout
        visible={backlogOpen}
        teamId={backlogTeam}
        onClose={() => setBacklogOpen(false)}
        onPopOut={() => void popOutBacklog(backlogTeam).then((opened) => opened && setBacklogOpen(false))}
      />
      <SettingsPanel visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </View>
  );
}

/** The team board on the board's sprint, which belongs to the team picked in the header's Team menu. */
function BoardTeamBoard({ onOpenBacklog }: { onOpenBacklog(): void }) {
  const sprint = useBoardSprint();
  const team = useBoardTeam();
  return <TeamBoard sprintPath={sprint?.path ?? null} sprintTeamId={team?.id ?? null} onOpenBacklog={onOpenBacklog} />;
}

/** Moves the Backlog to its own window (TB§5); resolves whether it opened. */
async function popOutBacklog(team: string | null): Promise<boolean> {
  const result = await invoke('app:popOutBacklog', team ? { team } : {});
  if (result.ok) return true;
  toast({ id: 'backlog-pop-out', tone: 'warning', title: "Couldn't pop out the backlog", body: result.message });
  return false;
}

/** "Sprint 42 · 7 – 20 Oct · 8 agent tickets". */
function BoardSubheader() {
  const sprint = useBoardSprint();
  const total = useAgentTicketTotal();
  return (
    <Text variant="body" color={color.muted} testID="board-subheader">
      {boardSubheader(sprint, total)}
    </Text>
  );
}

/** The app version and runtime, selectable so it can be copied into a bug report. */
function RuntimeInfo() {
  const appInfo = useAppInfo();
  return (
    <Text variant="mono" color={color.muted} selectable testID="runtime-info">
      {appInfo.data
        ? `v${appInfo.data.version} · Electron ${appInfo.data.versions.electron} · ${appInfo.data.platform}`
        : appInfo.isError
          ? 'Main process unreachable'
          : 'Connecting…'}
    </Text>
  );
}

const LEGEND = [
  { label: 'Azure DevOps', swatch: color.ado },
  { label: 'Claude activity', swatch: color.claude },
  { label: 'Needs you', swatch: color.attention },
] as const;

/** The colour key, or while a team board card is dragged "Drop !10571 on a highlighted lane" (artboard 09). */
function LegendOrDragStatus() {
  return useActiveDrag() ? <DragStatusPill /> : <Legend />;
}

/** Artboard 1's colour key: what blue, violet and amber mean on the cards. */
function Legend() {
  return (
    <View style={styles.legend} testID="board-legend">
      {LEGEND.map((entry) => (
        <View key={entry.label} style={styles.legendEntry}>
          <View aria-hidden style={[styles.swatch, { backgroundColor: entry.swatch }]} />
          <Text variant="body" size="sm">
            {entry.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  // The dock stays at the bottom while the lanes scroll (artboard 1).
  dock: {
    paddingHorizontal: space.xl,
    paddingBottom: space.xl,
  },
  content: {
    padding: space.xl,
    gap: space.xl,
  },
  titleBlock: {
    gap: space.xs,
  },
  subheaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.md,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingBottom: space.xs,
  },
  legendEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 3,
  },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: tone.attention.border,
    backgroundColor: tone.attention.band,
  },
});
