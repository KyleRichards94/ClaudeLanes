import type { BacklogPage } from '@agent-lanes/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { color, overlay, radius, space, tone } from '@agent-lanes/tokens';
import { Button, GlassPanel, SegmentedControl, Switch, Text, TextField } from '@agent-lanes/ui';
import { useWorkItemLanes, type AgentTicketStore } from '@/entities/agent-ticket';
import { useActiveDrag, usePendingDropLanes } from '@/features/drag-to-lane';
import { useBacklog, useConnections } from '@/shared/api';
import { openConnections } from '@/shared/model';
import { HeaderMenu } from '@/shared/ui';
import { setBacklogSearch, useBacklogSearch, type BacklogKindFilter } from '../model/session';
import { areaLabel, backlogFilters, backlogGroups, clickSelection, filterChoices, rowDrag, rowOrder, type BacklogGroupView, type BacklogMe } from '../model/view';
import { BacklogRow } from './BacklogRow';
import { onEscape } from './escape';
import { rememberFocus } from './focus';

export interface BacklogPopoutProps {
  visible: boolean;
  /** The team board's team; null for the team in the user's ADO profile. */
  teamId: string | null;
  /** Esc, the close button or a click on the board outside it (TB§5). */
  onClose(): void;
  /** Moves the backlog to its own window (TB§5). Without it there is no Pop out button. */
  onPopOut?: () => void;
  /**
   * `page` (default): a modal over the lower board, with the lanes live above it. `window`: fills the
   * popped-out window, whose rows are native drag sources for the main window's lanes.
   */
  mode?: 'page' | 'window';
  store?: AgentTicketStore;
}

/** How long typing pauses before the search goes to Azure DevOps. */
export const SEARCH_DELAY_MS = 250;

const KIND_OPTIONS: { value: BacklogKindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'story', label: 'Story' },
  { value: 'bug', label: 'Bug' },
  { value: 'task', label: 'Task' },
];

const NO_PAGES: readonly BacklogPage[] = [];

/**
 * `widgets/backlog-popout` (AL-239, T6, TB§5, artboards 11 and 12): the profile team's backlog in a
 * modal over the lower part of the board, grouped by Feature, with search, type, priority, area and
 * tag filters and the "in a sprint" toggle (remembered for the session). Rows drag onto Planning or
 * Implementing like team board cards; shift-click selects several and dragging any of them starts one
 * agent each. While a drag is under way the modal fades to 35 % and lets the pointer through to the
 * lanes. Esc, the close button or a click outside closes it; Pop out moves it to its own window.
 */
export function BacklogPopout(props: BacklogPopoutProps) {
  if (!props.visible) return null;
  return <BacklogPanel {...props} />;
}

function BacklogPanel({ teamId, onClose, onPopOut, mode = 'page', store }: BacklogPopoutProps) {
  const popped = mode === 'window';
  const connections = useConnections();
  const ado = connections.data?.find((row) => row.kind === 'ado') ?? null;
  const identity = ado?.identity ?? null;
  const me: BacklogMe | null = useMemo(() => (identity ? { displayName: identity } : null), [identity]);

  const search = useBacklogSearch();
  const [draft, setDraft] = useState(search.text);
  useEffect(() => {
    if (draft === search.text) return;
    const timer = setTimeout(() => setBacklogSearch({ text: draft }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, search.text]);
  const filters = useMemo(() => backlogFilters(search), [search]);
  const backlog = useBacklog(teamId, filters);
  const pages = backlog.data?.pages ?? NO_PAGES;

  const agentLanes = useWorkItemLanes(store);
  // A drop main has not confirmed yet already shows "Agent in Planning" (AL-235's optimistic update).
  const pendingLanes = usePendingDropLanes();
  const lanes = useMemo(() => ({ ...agentLanes, ...pendingLanes }), [agentLanes, pendingLanes]);
  const groups = useMemo(() => backlogGroups(pages, me, lanes), [pages, me, lanes]);
  const order = useMemo(() => rowOrder(groups), [groups]);
  const choices = useMemo(() => filterChoices(pages), [pages]);

  const [picked, setPicked] = useState<readonly number[]>([]);
  const [anchor, setAnchor] = useState<number | null>(null);
  // A row an agent has taken since (or one filtered away) drops out of the selection.
  const selectedRows = groups.flatMap((group) => group.rows.filter((row) => row.drag && picked.includes(row.id)));
  const selectedIds = selectedRows.map((row) => row.id);
  const select = (id: number, shift: boolean) => {
    setPicked(clickSelection({ selected: selectedIds, order, anchor, id, shift }));
    setAnchor(id);
  };

  const { height: windowHeight } = useWindowDimensions();
  const active = useActiveDrag();
  const dragging = active !== null && !popped;

  // Focus goes to the search box on open and back to the Backlog button on close.
  const [restoreFocus] = useState(rememberFocus);
  useEffect(() => restoreFocus, [restoreFocus]);

  // Escape closes it, except while a drag is under way: then Escape cancels the drag.
  const escapeState = useRef({ active, onClose });
  useEffect(() => {
    escapeState.current = { active, onClose };
  });
  useEffect(
    () =>
      onEscape(() => {
        if (!escapeState.current.active) escapeState.current.onClose();
      }),
    [],
  );

  const first = pages[0];
  const subtitle = [first?.team.name ?? null, first ? `${first.total} ${first.total === 1 ? 'item' : 'items'}` : null, 'unassigned items can be dragged onto Planning or Implementing']
    .filter(Boolean)
    .join(' · ');

  const content = (
    <View role="dialog" aria-label="Backlog" style={styles.dialog} testID="backlog-popout-panel">
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <Text variant="title" size="xl" role="heading" aria-level={2}>
            Backlog
          </Text>
          <Text variant="body" color={color.muted} testID="backlog-popout-subtitle">
            {subtitle}
          </Text>
        </View>
        {onPopOut && !popped ? <Button label="Pop out" icon="external-link" onPress={onPopOut} testID="backlog-popout-pop-out" /> : null}
        <Button label="Close the backlog" icon="close" iconOnly onPress={onClose} testID="backlog-popout-close" />
      </View>

      <View style={styles.filters}>
        <TextField
          variant="search"
          aria-label="Search the backlog"
          placeholder="Search by ID, title or tag"
          value={draft}
          onChangeText={setDraft}
          autoFocus
          style={styles.search}
          testID="backlog-search"
        />
        <SegmentedControl label="Type" tone="ink" options={KIND_OPTIONS} value={search.kind} onChange={(kind) => setBacklogSearch({ kind })} testID="backlog-kind" />
        <HeaderMenu
          label="Priority:"
          value={search.priority === null ? 'Any' : String(search.priority)}
          items={[{ key: 'any', label: 'Any', selected: search.priority === null }, ...[1, 2, 3, 4].map((value) => ({ key: String(value), label: `Priority ${value}`, selected: search.priority === value }))]}
          onSelect={(key) => setBacklogSearch({ priority: key === 'any' ? null : Number(key) })}
          testID="backlog-priority"
        />
        <HeaderMenu
          label="Area:"
          value={search.area === null ? 'All' : areaLabel(search.area)}
          items={[
            { key: '', label: 'All areas', selected: search.area === null },
            ...unionWith(choices.areas, search.area).map((area) => ({ key: area, label: areaLabel(area), detail: area, selected: search.area === area })),
          ]}
          onSelect={(key) => setBacklogSearch({ area: key === '' ? null : key })}
          testID="backlog-area"
        />
        <HeaderMenu
          label="Tag:"
          value={search.tag ?? 'Any'}
          items={[{ key: '', label: 'Any tag', selected: search.tag === null }, ...unionWith(choices.tags, search.tag).map((tag) => ({ key: tag, label: tag, selected: search.tag === tag }))]}
          onSelect={(key) => setBacklogSearch({ tag: key === '' ? null : key })}
          testID="backlog-tag"
        />
        <Switch
          label="In a sprint"
          value={search.includeInSprint}
          onValueChange={(includeInSprint) => setBacklogSearch({ includeInSprint })}
          stateText={{ on: 'Shown', off: 'Hidden' }}
          testID="backlog-in-sprint"
        />
      </View>

      {selectedRows.length > 0 ? (
        <View style={styles.selection} testID="backlog-selection">
          <Text variant="body" color={tone.claude.text}>
            {`${selectedRows.length} selected · drag any of them to start one agent each`}
          </Text>
          <Pressable role="button" onPress={() => setPicked([])} hitSlop={12} testID="backlog-selection-clear">
            <Text variant="title" size="sm" color={tone.claude.text}>
              Clear
            </Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} testID="backlog-list">
        {connections.isSuccess && ado === null ? (
          <View style={styles.message} testID="backlog-not-connected">
            <Text variant="body">Connect an Azure DevOps organisation to see your team's backlog.</Text>
            <Button label="Open Connections" size="sm" onPress={() => openConnections()} />
          </View>
        ) : backlog.isError ? (
          <View style={styles.message} role="alert" testID="backlog-error">
            <Text variant="body">{`Couldn't load the backlog. ${backlog.error.message}`}</Text>
            <Button label="Retry" size="sm" onPress={() => void backlog.refetch()} />
          </View>
        ) : !backlog.data ? (
          <Text variant="meta" testID="backlog-loading">
            Loading the backlog…
          </Text>
        ) : groups.length === 0 ? (
          <Text variant="meta" testID="backlog-empty">
            No backlog items match these filters.
          </Text>
        ) : (
          groups.map((group) => (
            <Group key={group.key} group={group} selectedIds={selectedIds} selectedRows={selectedRows} onSelect={select} popped={popped} />
          ))
        )}
        {backlog.hasNextPage ? (
          <Button label="Show more" size="sm" loading={backlog.isFetchingNextPage} onPress={() => void backlog.fetchNextPage()} style={styles.more} testID="backlog-more" />
        ) : null}
      </ScrollView>
    </View>
  );

  if (popped) {
    return (
      <View style={styles.window} testID="backlog-popout">
        {content}
      </View>
    );
  }
  return (
    <View style={[styles.layer, dragging && styles.layerDragging]} testID="backlog-popout">
      {/* A click on the board outside the modal closes it (TB§5); the close button is the keyboard way. */}
      <Pressable aria-label="Close the backlog" aria-hidden focusable={false} style={StyleSheet.absoluteFill} onPress={onClose} testID="backlog-popout-backdrop" />
      <View style={[styles.frame, { paddingTop: Math.max(PANEL_TOP, Math.round(windowHeight * PANEL_TOP_SHARE)) }]}>
        <GlassPanel level="xl" style={styles.panel}>
          {content}
        </GlassPanel>
      </View>
    </View>
  );
}

/** The menu's choices plus the one picked, which a filter may have hidden from the loaded rows. */
function unionWith(values: readonly string[], picked: string | null): readonly string[] {
  return picked === null || values.includes(picked) ? values : [...values, picked];
}

function Group({
  group,
  selectedIds,
  selectedRows,
  onSelect,
  popped,
}: {
  group: BacklogGroupView;
  selectedIds: readonly number[];
  selectedRows: Parameters<typeof rowDrag>[1];
  onSelect(id: number, shift: boolean): void;
  popped: boolean;
}) {
  return (
    <View style={styles.group} testID={`backlog-group-${group.key}`}>
      <View style={styles.groupHeader}>
        <View aria-hidden style={styles.groupDot} />
        <Text variant="title" size="sm" role="heading" aria-level={3}>
          {group.title}
        </Text>
        <Text variant="meta" aria-label={`${group.rows.length} ${group.rows.length === 1 ? 'item' : 'items'}`}>
          {String(group.rows.length)}
        </Text>
      </View>
      <View role="list" aria-label={group.title}>
        {group.rows.map((row) => (
          <BacklogRow
            key={row.id}
            row={row}
            drag={rowDrag(row, selectedRows)}
            selected={selectedIds.includes(row.id)}
            onSelect={(shift) => onSelect(row.id, shift)}
            popped={popped}
          />
        ))}
      </View>
    </View>
  );
}

/** Artboard 11: the modal starts over the lower part of the agent lanes and stops just above the window's bottom. */
const PANEL_TOP = 276;
/** The app's header and title sit higher than the artboard's, so on a taller window the modal starts lower: the lane headers stay in sight. */
const PANEL_TOP_SHARE = 0.42;
const PANEL_WIDTH = 1122;

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // TB§5: while a row is dragged the modal fades to 35 % and stops catching the pointer.
  layerDragging: {
    opacity: 0.35,
    pointerEvents: 'none',
  },
  frame: {
    flex: 1,
    pointerEvents: 'box-none',
    alignItems: 'center',
    paddingBottom: space.xxl + space.sm,
    paddingHorizontal: space.xl,
  },
  panel: {
    flex: 1,
    width: '100%',
    maxWidth: PANEL_WIDTH,
    borderRadius: radius.modal,
    overflow: 'hidden',
    boxShadow: overlay.shadow,
  },
  window: {
    flex: 1,
    backgroundColor: color.surface,
  },
  dialog: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    paddingBottom: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  search: {
    flexGrow: 1,
    flexBasis: 180,
  },
  selection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: space.md,
    gap: space.sm,
  },
  group: {
    gap: 0,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
  },
  groupDot: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: color.claude,
  },
  message: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.md,
    paddingHorizontal: space.xl,
  },
  more: {
    alignSelf: 'center',
    marginTop: space.sm,
  },
});
