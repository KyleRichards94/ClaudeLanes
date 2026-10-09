import type { Sprint } from '@agent-lanes/contracts';
import { Pressable, StyleSheet, View } from 'react-native';
import { color, minTarget, radius, space } from '@agent-lanes/tokens';
import { Button, GlassPanel, Pill, Text } from '@agent-lanes/ui';
import { agentTickets, useAgentTicketCount, type AgentTicketStore } from '@/entities/agent-ticket';
import { useAddRepo, useRepos, useTeams } from '@/shared/api';
import { openConnections, openNewTicket, toast, useBoardSprint, useBoardSprints, useBoardTeam, useUiPrefs } from '@/shared/model';
import { HeaderMenu, PlanLimitsPill, type HeaderMenuItem } from '@/shared/ui';
import { sprintRangeLabel } from '../model/header';
import { McpStatusPill } from './McpStatusPill';

/** The Repo menu's last item, which opens the folder picker (AL-081). */
export const ADD_REPO_KEY = '__add-repo__';

export interface BoardHeaderProps {
  /** Whether the lanes show only the tickets that need the user. */
  needsYouOnly: boolean;
  onNeedsYouOnlyChange(on: boolean): void;
  onOpenSettings(): void;
  store?: AgentTicketStore;
}

/**
 * The board header (AL-142, artboard 1): logo and "Agent Lanes", the Repo and Sprint dropdowns,
 * the live count pills, Connections, Settings and "+ New agent ticket". The counts come from the
 * agent ticket store and change as events arrive; "need you" toggles the board's needs-you filter.
 */
export function BoardHeader({ needsYouOnly, onNeedsYouOnlyChange, onOpenSettings, store = agentTickets }: BoardHeaderProps) {
  const running = useAgentTicketCount('running', store);
  const needsYou = useAgentTicketCount('needs-you', store);
  const queued = useAgentTicketCount('queued', store);

  return (
    <GlassPanel style={styles.header} testID="board-header">
      <View style={styles.brand}>
        <View style={styles.logo}>
          <Text variant="title" size="lg" color={color.surface}>
            ≡
          </Text>
        </View>
        <Text variant="title" size="lg">
          Agent Lanes
        </Text>
      </View>
      <RepoMenu />
      <TeamMenu />
      <SprintMenu />
      <View style={styles.spacer} />
      <View style={styles.pills} role="group" aria-label="Live counts">
        <Pill tone="claude" size="md" label={`${running} running`} testID="board-count-running" />
        <Pressable
          role="button"
          aria-pressed={needsYouOnly}
          aria-label={`${needsYou} need you. ${needsYouOnly ? 'Show every ticket' : 'Show only tickets that need you'}`}
          disabled={needsYou === 0 && !needsYouOnly}
          onPress={() => onNeedsYouOnlyChange(!needsYouOnly)}
          style={styles.pillButton}
          testID="board-count-needs-you"
        >
          <Pill tone="attention" size="md" label={`${needsYou} need you`} style={needsYouOnly ? styles.pillOn : undefined} />
        </Pressable>
        <Pill tone="neutral" size="md" label={`${queued} queued`} testID="board-count-queued" />
        {/* MCP servers of the running sessions, amber with the failing names on hover (AL-108). */}
        <McpStatusPill />
        {/* The plan's 5-hour and 7-day windows, once a session reported them (AL-258). */}
        <PlanLimitsPill />
      </View>
      {/* Artboard 1's Connections icon button (AL-046). */}
      <Button label="Connections" icon="link" iconOnly onPress={() => openConnections()} testID="open-connections" />
      {/* Repo and app settings (AL-146); not on artboard 1, which predates the panel. */}
      <Button label="Settings" onPress={onOpenSettings} testID="open-settings" />
      <Button variant="primary" icon="plus" label="New agent ticket" onPress={openNewTicket} testID="open-new-ticket" />
    </GlassPanel>
  );
}

/** Registered repos, the one the board shows ticked, and "Add repo…" (AL-081). */
function RepoMenu() {
  const repos = useRepos();
  const addRepo = useAddRepo();
  const lastRepo = useUiPrefs((state) => state.lastRepo);
  const setLastRepo = useUiPrefs((state) => state.setLastRepo);
  const list = repos.data ?? [];
  const repo = list.find((candidate) => candidate.path === lastRepo);

  const items: HeaderMenuItem[] = [
    ...list.map((candidate) => ({ key: candidate.path, label: candidate.name, selected: candidate.path === lastRepo })),
    { key: ADD_REPO_KEY, label: 'Add repo…' },
  ];

  const onSelect = async (key: string) => {
    if (key !== ADD_REPO_KEY) {
      setLastRepo(key);
      return;
    }
    try {
      const outcome = await addRepo.mutateAsync();
      // `rejected`: main already said why; `cancelled`: nothing to say.
      if (outcome.status === 'added' || outcome.status === 'existing') setLastRepo(outcome.repo.path);
    } catch (error) {
      toast({ id: 'add-repo-failed', tone: 'error', title: 'Could not add the repo', body: error instanceof Error ? error.message : undefined });
    }
  };

  return (
    <HeaderMenu
      label="Repo"
      value={repo?.name ?? (list.length === 0 ? 'Add a repo' : 'Choose')}
      items={items}
      onSelect={(key) => void onSelect(key)}
      testID="board-repo-menu"
      valueTestID="board-repo"
    />
  );
}

/**
 * The user's ADO teams, the board's ticked. Sprints are chosen per team, so picking another team
 * goes back to its current sprint. Defaults to the team ADO opens on (`useBoardTeam`).
 */
function TeamMenu() {
  const teams = useTeams();
  const team = useBoardTeam();
  const setLastTeam = useUiPrefs((state) => state.setLastTeam);
  const list = teams.data?.teams ?? [];

  const items: HeaderMenuItem[] = list.map((candidate) => ({ key: candidate.id, label: candidate.name, selected: candidate.id === team?.id }));

  return (
    <HeaderMenu
      label="Team"
      value={team?.name ?? (teams.isPending ? '…' : 'None')}
      items={items}
      disabled={list.length === 0}
      onSelect={(key) => {
        if (key !== team?.id) setLastTeam(key);
      }}
      testID="board-team-menu"
      valueTestID="board-team"
    />
  );
}

/** Where a sprint goes in the Sprint menu. */
const SPRINT_SECTIONS = { current: 'Current', future: 'Upcoming', past: 'Past' } as const;

/**
 * The Sprint menu's items: Current, then Upcoming (soonest first), then Past (newest first), each
 * with its dates ("7 – 20 Oct"). Every sprint can be picked.
 */
export function sprintMenuItems(sprints: readonly Sprint[], selectedId: string | null | undefined, currentYear?: number): HeaderMenuItem[] {
  const item = (sprint: Sprint): HeaderMenuItem => {
    const range = sprintRangeLabel(sprint, currentYear);
    return {
      key: sprint.id,
      label: sprint.name,
      ...(range ? { detail: range } : {}),
      selected: sprint.id === selectedId,
      section: SPRINT_SECTIONS[sprint.timeFrame],
    };
  };
  const inFrame = (timeFrame: Sprint['timeFrame']) => sprints.filter((sprint) => sprint.timeFrame === timeFrame);
  return [...inFrame('current'), ...inFrame('future'), ...inFrame('past').toReversed()].map(item);
}

/** The board team's sprints; the current one until the user picks another, kept in the UI prefs (AL-041). */
function SprintMenu() {
  const sprints = useBoardSprints({ live: true });
  const setLastSprint = useUiPrefs((state) => state.setLastSprint);
  const sprint = useBoardSprint();
  const list = sprints.data?.sprints ?? [];
  const items = sprintMenuItems(list, sprint?.id);

  return (
    <HeaderMenu
      label="Sprint"
      value={sprint ? sprintNumber(sprint) : sprints.isPending ? '…' : 'None'}
      items={items}
      disabled={list.length === 0}
      onSelect={setLastSprint}
      testID="board-sprint-menu"
      valueTestID="board-sprint"
    />
  );
}

/** "Sprint 42" → "42", as artboard 1's button shows it; other names whole. */
function sprintNumber(sprint: Pick<Sprint, 'name'>): string {
  return /^Sprint\s+(\S+)$/i.exec(sprint.name)?.[1] ?? sprint.name;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginRight: space.xs,
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: radius.chip,
    backgroundColor: color.claude,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacer: {
    flex: 1,
  },
  pills: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  // The pill is 28 px; the pressable target around it is 44 px tall (design §11).
  pillButton: {
    minHeight: minTarget,
    justifyContent: 'center',
  },
  pillOn: {
    boxShadow: `0 0 0 2px ${color.attention}`,
  },
});
