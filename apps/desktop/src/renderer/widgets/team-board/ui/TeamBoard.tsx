import type { TeamRef } from '@agent-lanes/contracts';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Button, GlassPanel, SegmentedControl, Text } from '@agent-lanes/ui';
import { useWorkItemLanes, type AgentTicketStore } from '@/entities/agent-ticket';
import { usePendingDropLanes } from '@/features/drag-to-lane';
import { useActivePrs, useBacklogTotal, useConnections, useTeamBoard, useTeams } from '@/shared/api';
import { openConnections } from '@/shared/model';
import { HeaderMenu } from '@/shared/ui';
import { setTeamBoardFilter, setTeamBoardTeam, useTeamBoardSession } from '../model/session';
import { teamBoardColumns, type ColumnTone, type TeamBoardColumnView, type TeamBoardFilter, type TeamBoardMe } from '../model/view';
import { TeamBoardItemCard, TeamBoardPullRequestCard } from './TeamBoardCards';

export interface TeamBoardProps {
  /** The agent board's sprint (its `path`), used for the profile's team; another team shows its own current sprint. */
  sprintPath?: string | null;
  /**
   * The team `sprintPath` belongs to (the agent board's Team menu). When given, the sprint is used for
   * that team instead of the profile's; other teams show their own current sprint.
   */
  sprintTeamId?: string | null;
  /** Opens the Backlog popout (AL-239). Without it the Backlog button is off. */
  onOpenBacklog?: () => void;
  store?: AgentTicketStore;
}

/**
 * `widgets/team-board` (AL-234, T1, T7, TB§2, artboard 08): the team's Azure DevOps board under the
 * agent lanes. Columns as the team's board names them, then Active PRs; Everyone / Me / Unassigned
 * and the team are kept for the session. Board and PRs refresh every 60 s while the window can be
 * seen, and on focus (`['ado','teamBoard',team,sprint]`, `['ado','activePrs',team]`).
 */
export function TeamBoard({ sprintPath = null, sprintTeamId, onOpenBacklog, store }: TeamBoardProps) {
  const connections = useConnections();
  const ado = connections.data?.find((row) => row.kind === 'ado') ?? null;
  const session = useTeamBoardSession();
  const teams = useTeams();
  const teamList = teams.data?.teams ?? [];
  const defaultTeamId = teams.data?.defaultTeamId ?? null;
  // A team picked earlier that the user is no longer in falls back to the profile's.
  const pickedTeam = session.teamId !== null && teamList.some((team) => team.id === session.teamId) ? session.teamId : null;
  const onProfileTeam = pickedTeam === null || pickedTeam === defaultTeamId;
  // Without a sprint team (the board's teams could not be read), the sprint is the profile team's, as main resolves it.
  const onSprintTeam = sprintTeamId == null ? onProfileTeam : (pickedTeam ?? defaultTeamId) === sprintTeamId;
  const board = useTeamBoard(pickedTeam, onSprintTeam ? sprintPath : null);
  const prs = useActivePrs(pickedTeam);
  const backlog = useBacklogTotal(pickedTeam);
  const agentLanes = useWorkItemLanes(store);
  // A drop main has not confirmed yet already shows "Agent in <lane>" (AL-235's optimistic update).
  const pendingLanes = usePendingDropLanes();
  const workItemLanes = useMemo(() => ({ ...agentLanes, ...pendingLanes }), [agentLanes, pendingLanes]);

  const me: TeamBoardMe | null = ado?.identity ? { displayName: ado.identity } : null;
  const columns = teamBoardColumns({ board: board.data, pullRequests: prs.data?.pullRequests, me, workItemLanes, filter: session.filter });
  const team = board.data?.team ?? teamList.find((candidate) => candidate.id === (pickedTeam ?? defaultTeamId)) ?? null;

  const state: TeamBoardViewProps['state'] =
    connections.isSuccess && ado === null
      ? { kind: 'not-connected' }
      : board.isError
        ? { kind: 'error', message: board.error.message }
        : board.data
          ? { kind: 'ready' }
          : { kind: 'loading' };

  return (
    <TeamBoardView
      orgName={ado?.name ?? null}
      teams={teamList}
      team={team}
      fromProfile={team !== null && team.id === defaultTeamId}
      onTeamChange={(id) => setTeamBoardTeam(id === defaultTeamId ? null : id)}
      filter={session.filter}
      onFilterChange={setTeamBoardFilter}
      columns={columns}
      backlogTotal={backlog.data ?? null}
      onOpenBacklog={onOpenBacklog}
      state={state}
      onRetry={() => {
        void board.refetch();
        void prs.refetch();
      }}
      onConnect={() => openConnections()}
      prsError={prs.isError ? prs.error.message : null}
    />
  );
}

export interface TeamBoardViewProps {
  /** "CompanionSystems"; null before an organisation is connected. */
  orgName: string | null;
  teams: readonly TeamRef[];
  team: TeamRef | null;
  /** The team is the one from the user's ADO profile. */
  fromProfile: boolean;
  onTeamChange(teamId: string): void;
  filter: TeamBoardFilter;
  onFilterChange(filter: TeamBoardFilter): void;
  columns: readonly TeamBoardColumnView[];
  backlogTotal: number | null;
  onOpenBacklog?: () => void;
  state: { kind: 'ready' } | { kind: 'loading' } | { kind: 'not-connected' } | { kind: 'error'; message: string };
  onRetry(): void;
  onConnect(): void;
  /** Active PRs could not be read; the column says so. */
  prsError?: string | null;
}

const FILTER_OPTIONS = [
  { value: 'everyone' as const, label: 'Everyone' },
  { value: 'me' as const, label: 'Me' },
  { value: 'unassigned' as const, label: 'Unassigned' },
];

const DOTS: Readonly<Record<ColumnTone, string>> = {
  neutral: tone.neutral.dot,
  ado: tone.ado.dot,
  claude: tone.claude.dot,
  attention: tone.attention.dot,
  danger: tone.danger.dot,
  ink: color.ink,
};

/** The team board as drawn, from data (also the component gallery's sample). */
export function TeamBoardView(props: TeamBoardViewProps) {
  const { orgName, teams, team, fromProfile, onTeamChange, filter, onFilterChange, columns, backlogTotal, onOpenBacklog, state, onRetry, onConnect, prsError } =
    props;
  return (
    <GlassPanel style={styles.panel} testID="team-board">
      <View role="region" aria-label="Team board" style={styles.inner}>
        <View style={styles.header}>
          <View style={styles.titleBlock}>
            <Text variant="meta" testID="team-board-org">
              {orgName ? `Azure DevOps · ${orgName}` : 'Azure DevOps'}
            </Text>
            <Text variant="title" size="xl" role="heading" aria-level={2}>
              Team board
            </Text>
          </View>
          <HeaderMenu
            label="Team"
            value={team?.name ?? (state.kind === 'not-connected' ? 'Not connected' : 'Loading…')}
            valueNote={fromProfile ? '· from your ADO profile' : undefined}
            items={teams.map((candidate) => ({ key: candidate.id, label: candidate.name, selected: candidate.id === team?.id }))}
            onSelect={onTeamChange}
            disabled={teams.length === 0}
            testID="team-board-team"
            valueTestID="team-board-team-name"
          />
          <SegmentedControl label="Show cards for" tone="ink" options={FILTER_OPTIONS} value={filter} onChange={onFilterChange} testID="team-board-filter" />
          <View style={styles.spacer} />
          <Text variant="meta" testID="team-board-hint">
            Your or unassigned cards · any open PR for review
          </Text>
          <Button
            label={backlogTotal === null ? 'Backlog' : `Backlog ${backlogTotal}`}
            icon="backlog"
            variant="strong"
            disabled={!onOpenBacklog}
            onPress={onOpenBacklog}
            testID="team-board-backlog"
          />
        </View>

        {state.kind === 'not-connected' ? (
          <View style={styles.message} testID="team-board-not-connected">
            <Text variant="body">Connect an Azure DevOps organisation to see your team's board here.</Text>
            <Button label="Open Connections" size="sm" onPress={onConnect} />
          </View>
        ) : state.kind === 'error' ? (
          <View style={styles.message} role="alert" testID="team-board-error">
            <Text variant="body">{`Couldn't load the team board. ${state.message}`}</Text>
            <Button label="Retry" size="sm" onPress={onRetry} />
          </View>
        ) : state.kind === 'loading' ? (
          <Text variant="meta" testID="team-board-loading">
            Loading the team board…
          </Text>
        ) : (
          <ScrollView horizontal style={styles.scroller} contentContainerStyle={styles.columnsContent} testID="team-board-columns">
            <View style={styles.columns}>
              {columns.map((column) => (
                <Column key={column.id} column={column} note={column.kind === 'active-prs' && prsError ? `Couldn't load the pull requests. ${prsError}` : null} />
              ))}
            </View>
          </ScrollView>
        )}
      </View>
    </GlassPanel>
  );
}

function Column({ column, note }: { column: TeamBoardColumnView; note: string | null }) {
  const prs = column.kind === 'active-prs';
  return (
    <View style={[styles.column, prs && styles.prColumn]} testID={`team-column-${column.kind === 'active-prs' ? 'active-prs' : column.id}`}>
      <View style={styles.columnHeader}>
        <View aria-hidden style={[styles.dot, { backgroundColor: DOTS[column.tone] }]} />
        <Text variant="title" size="sm" role="heading" aria-level={3} numberOfLines={1} style={styles.flexText}>
          {column.name}
        </Text>
        <Text variant="meta" aria-label={`${column.count} ${column.count === 1 ? 'card' : 'cards'}`}>
          {String(column.count)}
        </Text>
      </View>
      <View role="list" aria-label={column.name} style={styles.cards}>
        {column.cards.map((card) =>
          card.kind === 'item' ? <TeamBoardItemCard key={`i${card.id}`} card={card} /> : <TeamBoardPullRequestCard key={`p${card.id}`} card={card} />,
        )}
      </View>
      {note ? <Text variant="meta">{note}</Text> : column.cards.length === 0 ? <Text variant="meta">{prs ? 'No open pull requests' : 'Nothing here'}</Text> : null}
    </View>
  );
}

/** Six columns at their narrowest and the gaps: below this the row scrolls sideways. */
const COLUMN_MIN_WIDTH = 190;

const styles = StyleSheet.create({
  panel: {
    padding: space.xl,
  },
  inner: {
    gap: space.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.md,
  },
  titleBlock: {
    gap: 2,
    marginRight: space.sm,
  },
  spacer: {
    flexGrow: 1,
  },
  message: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.md,
  },
  scroller: {
    flexGrow: 0,
  },
  columnsContent: {
    width: '100%',
    minWidth: 6 * COLUMN_MIN_WIDTH + 5 * space.md,
  },
  columns: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingBottom: space.sm,
  },
  column: {
    flex: 1,
    minWidth: COLUMN_MIN_WIDTH,
    gap: space.sm,
    padding: space.sm,
    borderRadius: radius.card,
    backgroundColor: 'transparent',
  },
  prColumn: {
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: tone.neutral.band,
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.xs,
    minHeight: 28,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  flexText: {
    flex: 1,
  },
  cards: {
    gap: space.sm,
  },
});
