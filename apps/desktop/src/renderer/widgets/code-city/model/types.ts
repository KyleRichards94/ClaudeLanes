import type { ReactNode } from 'react';
import type { ChangedFile, ReviewFinding, ReviewStatus } from '@agent-lanes/contracts';

/** What an agent is doing to its active file. */
export type CityAgentKind = 'read' | 'edit' | 'review' | 'test' | 'idle';

export interface CityAgent {
  id: string;
  name: string;
  model: string | null;
  /** The agent's colour, the same in both ticket layouts (the lead is always #5B4BC4). */
  color: string;
  role: 'lead' | 'sub' | 'reviewer' | 'helper';
  status: 'running' | 'idle' | 'done' | 'error';
  /** A path in the ticket's worktree; null when the agent is not on a file. */
  activeFile: string | null;
  activeKind: CityAgentKind;
}

export interface CityStage {
  id: string;
  label: string;
  state: 'done' | 'current' | 'upcoming';
  /** "Approved", "Approval", "Auto" or a progress line like "Inspecting · 60%". */
  caption: string;
  /** 0..1 progress of the current stage; null if unknown. */
  progress: number | null;
}

/**
 * Everything Code City shows arrives through props: the widget is presentational (it has no store, IPC or
 * query of its own) because widgets cannot import pages, and the ticket page owns that wiring.
 */
export interface CodeCityProps {
  files: readonly ChangedFile[];
  /** The base ref the files are compared with ("main"). */
  base: string;
  loading: boolean;
  /** `diff:files` failed: an error card on the scene with Retry. The rail stays usable. */
  error: { message: string } | null;
  onRetry(): void;
  /** Every agent in the session. `files[i].uncommitted` drives the inspector's amber chip and the dashed top outline. */
  agents: readonly CityAgent[];
  reviewStatus: Readonly<Record<string, ReviewStatus>>;
  findings: readonly ReviewFinding[];
  selectedFilePath: string | null;
  onSelectFile(path: string | null): void;
  followAgent: boolean;
  /** The file of the most recent edit or review activity, for Follow agent. */
  latestActivityPath: string | null;
  diffMode: 'unified' | 'split';
  onDiffModeChange(mode: 'unified' | 'split'): void;
  stages: readonly CityStage[];
  legendDismissed: boolean;
  onDismissLegend(): void;
  /** The "Blueprint diff" body: the existing per-file diff renderer. */
  renderDiff(file: ChangedFile, mode: 'unified' | 'split', stripeColor: string): ReactNode;
  /** The compact composer bar under the stage track. */
  composer: ReactNode;
  /** The Worktree card at the bottom of the rail. */
  worktree: ReactNode;
  /** A finding's "Posted to PR" link was opened. */
  onOpenPrThread?(threadId: number): void;
  testID?: string;
}

/** The colour of a file with no known author ("by you or a merge"). */
export const UNKNOWN_AUTHOR_COLOR = '#94A3B8';
