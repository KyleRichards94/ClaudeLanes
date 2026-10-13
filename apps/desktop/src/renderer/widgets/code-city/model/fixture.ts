import type { ChangedFile, ReviewFinding, ReviewStatus } from '@agent-lanes/contracts';
import type { CityAgent, CityStage } from './types';

/**
 * The reference ticket from the handoff (work item 11726): five files under `OnSiteCompanion/`, five agents.
 * Used by the widget's tests and by the later e2e fixture.
 */

export const FIXTURE_BASE = 'main';

function file(path: string, added: number, removed: number, authorAgentId: string | null, fields: Partial<ChangedFile> = {}): ChangedFile {
  return {
    path,
    oldPath: null,
    kind: 'modified',
    added,
    removed,
    authorAgentId,
    touchedBy: authorAgentId ? [authorAgentId] : [],
    uncommitted: false,
    ...fields,
  };
}

export const FIXTURE_PATHS = {
  razor: 'OnSiteCompanion/ComponentLibrary/Pages/Companion/FailedSyncFiles.razor',
  tests: 'OnSiteCompanion/Tests/Companion/FailedSyncFilesTests.cs',
  legacy: 'OnSiteCompanion/Legacy.WinExe/OfflineSynchronisation/frmFailedFiles.vb',
  razorCs: 'OnSiteCompanion/ComponentLibrary/Pages/Companion/FailedSyncFiles.razor.cs',
  formatter: 'OnSiteCompanion/ComponentLibrary/Components/CompanionGridFormatter.cs',
} as const;

export const fixtureFiles: readonly ChangedFile[] = [
  file(FIXTURE_PATHS.razor, 120, 0, 'lead', { kind: 'added' }),
  file(FIXTURE_PATHS.tests, 64, 0, 'tester', { kind: 'added' }),
  file(FIXTURE_PATHS.legacy, 3, 44, 'legacy'),
  file(FIXTURE_PATHS.razorCs, 38, 2, 'builder'),
  file(FIXTURE_PATHS.formatter, 6, 1, 'builder'),
];

export const fixtureAgents: readonly CityAgent[] = [
  { id: 'lead', name: 'lead', model: 'Opus 4.7', color: '#5B4BC4', role: 'lead', status: 'running', activeFile: null, activeKind: 'idle' },
  { id: 'builder', name: 'builder', model: 'Sonnet 4.6', color: '#0369A1', role: 'sub', status: 'running', activeFile: FIXTURE_PATHS.razorCs, activeKind: 'edit' },
  { id: 'tester', name: 'tester', model: 'Sonnet 4.6', color: '#0D9488', role: 'sub', status: 'done', activeFile: null, activeKind: 'idle' },
  { id: 'reviewer', name: 'reviewer', model: 'Opus 4.7', color: '#7C3AED', role: 'reviewer', status: 'running', activeFile: FIXTURE_PATHS.razor, activeKind: 'review' },
  { id: 'legacy', name: 'legacy', model: 'Haiku 4.5', color: '#B45309', role: 'sub', status: 'done', activeFile: null, activeKind: 'idle' },
];

export const fixtureReviewStatus: Readonly<Record<string, ReviewStatus>> = {
  [FIXTURE_PATHS.razor]: 'inReview',
  [FIXTURE_PATHS.tests]: 'passed',
  [FIXTURE_PATHS.razorCs]: 'changesRequested',
};

export const fixtureFindings: readonly ReviewFinding[] = [
  { id: 'reviewer:razorcs:42:0', filePath: FIXTURE_PATHS.razorCs, line: 42, severity: 'warn', text: 'The retry loop swallows the exception; log it before continuing.', agentId: 'reviewer', prThreadId: 4821 },
  { id: 'reviewer:razorcs:77:1', filePath: FIXTURE_PATHS.razorCs, line: 77, severity: 'error', text: 'Dispose the CancellationTokenSource when the page is torn down.', agentId: 'reviewer' },
  { id: 'reviewer:razorcs:0:2', filePath: FIXTURE_PATHS.razorCs, line: null, severity: 'info', text: 'Consider moving the sync status text into the resource file.', agentId: 'reviewer' },
  { id: 'reviewer:tests:12:0', filePath: FIXTURE_PATHS.tests, line: 12, severity: 'info', text: 'Nice coverage of the offline path.', agentId: 'reviewer' },
];

export const fixtureStages: readonly CityStage[] = [
  { id: 'planning', label: 'Planning', state: 'done', caption: 'Approved', progress: null },
  { id: 'implementing', label: 'Implementing', state: 'done', caption: 'Approved', progress: null },
  { id: 'codeReview', label: 'Code review', state: 'current', caption: 'Inspecting · 60%', progress: 0.6 },
  { id: 'qa', label: 'QA', state: 'upcoming', caption: 'Approval', progress: null },
  { id: 'createPr', label: 'Create PR', state: 'upcoming', caption: 'Auto', progress: null },
];
