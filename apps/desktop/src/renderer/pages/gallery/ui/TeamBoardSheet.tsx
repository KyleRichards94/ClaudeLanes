import type { ActivePullRequest, TeamBoard, TeamBoardItem, TeamBoardPerson } from '@agent-lanes/contracts';
import { useState } from 'react';
import { TeamBoardView, teamBoardColumns, type TeamBoardFilter } from '@/widgets/team-board';
import { GallerySheet } from './GallerySection';

/** People on artboard 08: Kyle Richards (you), MD, TY and RJ. */
function person(displayName: string, initials: string): TeamBoardPerson {
  return { id: `id-${initials}`, displayName, uniqueName: null, initials };
}
const KR = person('Kyle Richards', 'KR');
const MD = person('MD', 'MD');
const TY = person('TY', 'TY');
const RJ = person('RJ', 'RJ');

const COLUMNS = [
  { id: 'todo', name: 'To Do', kind: 'to-do' },
  { id: 'doing', name: 'In Progress', kind: 'in-progress' },
  { id: 'review', name: 'Code Review', kind: 'code-review' },
  { id: 'testing', name: 'Testing', kind: 'testing' },
  { id: 'failed', name: 'Failed', kind: 'failed' },
] as const;

function item(id: number, columnId: (typeof COLUMNS)[number]['id'], type: string, title: string, fields: Partial<TeamBoardItem> = {}): TeamBoardItem {
  const column = COLUMNS.find((candidate) => candidate.id === columnId)!;
  return {
    id,
    type,
    title,
    state: 'Active',
    points: null,
    columnId,
    column: column.name,
    columnKind: column.kind,
    assignee: null,
    branch: null,
    pullRequestId: null,
    webUrl: `https://dev.azure.com/CompanionSystems/_workitems/edit/${id}`,
    ...fields,
  };
}

/** Artboard 08's board ("Board at rest", TB§2). */
const board: TeamBoard = {
  team: { id: 'osc', name: 'OSC Developers' },
  sprint: { id: 's42', name: 'Sprint 42', path: 'OnSite\\Sprint 42' },
  columns: COLUMNS.map((column) => ({ ...column })),
  items: [
    item(71341, 'todo', 'Bug', 'Roster view ignores public holidays', { points: 3, assignee: MD }),
    item(71335, 'todo', 'User Story', 'Client portal: show defect photos inline', { points: 5 }),
    item(71273, 'doing', 'User Story', 'Cutover frmJobControl to Blazor', { points: 8, assignee: KR }),
    item(71352, 'doing', 'Bug', 'Timesheet approval email sends twice', { points: 2, assignee: RJ }),
    item(71298, 'review', 'User Story', 'Supplier invoice matching rules', { pullRequestId: 10598, assignee: TY }),
    item(71301, 'review', 'User Story', 'Defect request accept modal', { pullRequestId: 10604, assignee: KR }),
    item(71310, 'testing', 'Bug', 'Timesheet export times out', { state: 'Resolved', assignee: KR }),
    item(71287, 'testing', 'User Story', 'Asset QR labels print at wrong size', { state: 'Resolved', assignee: MD }),
    item(71318, 'failed', 'Bug', 'Quote PDF totals round incorrectly', { state: 'Failed UAT', assignee: KR }),
  ],
};

function pullRequest(id: number, title: string, threads: number, author: TeamBoardPerson, reviewer: TeamBoardPerson): ActivePullRequest {
  return {
    id,
    title,
    isDraft: false,
    author,
    reviewers: [{ ...reviewer, vote: 0, isRequired: false, isContainer: false }],
    sourceBranch: `${id}-branch`,
    targetBranch: 'main',
    repository: { id: 'repo', name: 'onsite-companion', projectId: 'project', projectName: 'OnSite' },
    createdAt: '2026-10-07T03:00:00.000Z',
    unresolvedThreads: threads,
    repoRegistered: true,
    webUrl: `https://dev.azure.com/CompanionSystems/_git/onsite-companion/pullrequest/${id}`,
  };
}

const pullRequests = [
  pullRequest(10598, 'Supplier invoice matching rules', 4, MD, TY),
  pullRequest(10571, 'Job notes rich text editor', 6, KR, KR),
];

const lanes = { '71273': 'implementing', '71301': 'code-review', '71310': 'qa' } as const;

/** The team board widget (AL-234) on artboard 08's data, for checking against `08-team-board.png`. */
export function TeamBoardSheet() {
  const [filter, setFilter] = useState<TeamBoardFilter>('everyone');
  const columns = teamBoardColumns({ board, pullRequests, me: { displayName: 'Kyle Richards' }, workItemLanes: lanes, filter });
  return (
    <GallerySheet kicker="Artboard 08" title="Team board" testID="gallery-team-board">
      <TeamBoardView
        orgName="CompanionSystems"
        teams={[board.team]}
        team={board.team}
        fromProfile
        onTeamChange={() => undefined}
        filter={filter}
        onFilterChange={setFilter}
        columns={columns}
        backlogTotal={48}
        onOpenBacklog={() => undefined}
        state={{ kind: 'ready' }}
        onRetry={() => undefined}
        onConnect={() => undefined}
      />
    </GallerySheet>
  );
}
