import { defaultStageGates, type ChangedFile, type ReviewStatus } from '@agent-lanes/contracts';
import type { AgentView } from '@/entities/agent';
import type { Turn } from '@/entities/turn';
import type { StageStepInput } from './stage-meta';

/** The reference ticket of the handoff (#11726): five files, four agents, seven turns. Shared by the widget's tests. */

export const LEAD = 'ticket-11726';

export function agent(overrides: Partial<AgentView> & Pick<AgentView, 'id' | 'name'>): AgentView {
  return {
    role: 'sub',
    model: 'Sonnet',
    color: '#0369A1',
    status: 'idle',
    activeFile: null,
    activeKind: 'idle',
    activeAt: null,
    tokens: null,
    branch: null,
    ...overrides,
  };
}

export const agents: readonly AgentView[] = [
  agent({ id: LEAD, name: 'Lead', role: 'lead', model: 'Opus', color: '#5B4BC4', status: 'running', activeFile: 'src/Pages/FailedSyncFiles.razor', activeKind: 'edit', activeAt: 10, tokens: 212_000 }),
  agent({ id: 'writer', name: 'razor-writer', color: '#0369A1', status: 'running', tokens: 90_000, branch: 'sub/11726-razor' }),
  agent({ id: 'tester', name: 'test-writer', color: '#0D9488', status: 'done', tokens: 40_000, branch: 'sub/11726-tests' }),
  agent({ id: 'eyes', name: 'reviewer', role: 'reviewer', color: '#7C3AED', status: 'idle', tokens: null }),
];

export function file(path: string, added: number, removed: number, overrides: Partial<ChangedFile> = {}): ChangedFile {
  return { path, oldPath: null, kind: 'modified', added, removed, authorAgentId: LEAD, touchedBy: [LEAD], uncommitted: false, ...overrides };
}

export const files: readonly ChangedFile[] = [
  file('src/Pages/Companion/FailedSyncFiles.razor', 120, 0, { kind: 'added' }),
  file('tests/FailedSyncFilesTests.cs', 64, 0, { kind: 'added', authorAgentId: 'tester', touchedBy: ['tester'] }),
  file('legacy/frmFailedFiles.vb', 3, 44, { authorAgentId: null, touchedBy: [] }),
  file('src/Pages/Companion/FailedSyncFiles.razor.cs', 38, 2, { authorAgentId: 'writer', touchedBy: ['writer'], uncommitted: true }),
  file('src/Components/CompanionGridFormatter.cs', 6, 1),
];

export const reviewStatus: Readonly<Record<string, ReviewStatus>> = {
  'src/Pages/Companion/FailedSyncFiles.razor': 'passed',
  'tests/FailedSyncFilesTests.cs': 'changesRequested',
  'src/Pages/Companion/FailedSyncFiles.razor.cs': 'inReview',
};

export function turn(index: number, overrides: Partial<Turn> = {}): Turn {
  return {
    index,
    leadAgentId: LEAD,
    startedAt: index * 1_000,
    endedAt: index * 1_000 + 500,
    durationMs: 4 * 60_000,
    costUsd: 0.3,
    stage: 'implementing',
    summary: `Summary of turn ${index}.`,
    toolCounts: { Edit: 3, Bash: 4, Read: 1 },
    ...overrides,
  };
}

/** Planning (2 turns), Implementing (4), the seventh is the live turn in Implementing. */
export const turns: readonly Turn[] = [
  turn(1, { stage: 'planning', durationMs: 3 * 60_000, costUsd: 0.2 }),
  turn(2, { stage: 'planning', durationMs: 2 * 60_000, costUsd: 0.1 }),
  turn(3, { durationMs: 8 * 60_000, costUsd: 0.5 }),
  turn(4, { leadAgentId: 'writer', durationMs: 5 * 60_000, costUsd: 0.4 }),
  turn(5, { leadAgentId: 'tester', durationMs: 1 * 60_000, costUsd: 0.06 }),
  turn(6, { durationMs: 6 * 60_000, costUsd: 0.8 }),
  turn(7, { endedAt: null, durationMs: 90_000, costUsd: 0, summary: '' }),
];

export const steps: readonly StageStepInput[] = [
  { stage: 'planning', state: 'done', durationMs: 12 * 60_000 },
  { stage: 'implementing', state: 'current', durationMs: null },
  { stage: 'code-review', state: 'upcoming', durationMs: null },
  { stage: 'qa', state: 'upcoming', durationMs: null },
  { stage: 'create-pr', state: 'upcoming', durationMs: null },
];

export const gates = defaultStageGates();
