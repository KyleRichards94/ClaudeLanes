import type {
  BuildJobKind,
  Effort,
  Lane,
  Model,
  PullRequestStatus,
  Stage,
  StageGates,
  TicketAdoRef,
  TicketLastBuild,
} from '@agent-lanes/contracts';

/**
 * One agent ticket as the board and the drill-in see it (design §6 "Live client state"): what the
 * ticket record holds (AL-101) plus live state the main process pushes as events. Values are
 * immutable; every change makes a new object, so a component that selects one ticket re-renders
 * only when that ticket changed.
 */
export interface AgentTicket {
  /** The work item id or the `nt-…` name (AL-082); also the record and worktree folder name. */
  readonly id: string;
  /** Card title: the work item title, or the start of the job description (AL-101 D267). */
  readonly title: string;
  /** The ADO work item; null for a "No ticket" ticket. Its ADO state is server data (TanStack Query). */
  readonly ado: TicketAdoRef | null;
  /** Absolute path of the repo's main checkout (settings D63). */
  readonly repo: string;
  /** The ticket branch (AL-082) and the branch it merges back into. */
  readonly branch: string;
  readonly baseBranch: string;
  readonly createdAt: number;

  /** The lane the card is in: Queued, one of the five stages, or Done. */
  readonly stage: Lane;
  /** When the ticket entered `stage`; cards in a lane are ordered by it, oldest first. */
  readonly stageEnteredAt: number;
  /** Which stages wait for approval (artboard 2 Stage gates), editable per ticket (AL-171). */
  readonly gates: StageGates;

  /** The card's activity row ("Editing JobControl.razor +214"); null until the agent reports one. */
  readonly activity: AgentTicketActivity | null;
  /** The card's progress bar, 0 to 1; null until reported. */
  readonly progress: number | null;
  /** When the session last produced output (`agent:output`); null before any. */
  readonly lastOutputAt: number | null;

  /** The model and effort the session runs with now (R7). */
  readonly model: Model;
  readonly effort: Effort;
  /** A model or effort change that applies from the next turn ("Opus → Sonnet · High"); null when none is pending. */
  readonly switching: AgentTicketModelSwitch | null;

  /** The stage gate waiting for the user ("Needs you · approve plan", AL-104); null when none waits. */
  readonly gate: AgentTicketGate | null;
  /** Why the ticket needs the user, oldest first, one per kind. Empty when it does not. */
  readonly needsYou: readonly NeedsYouReason[];

  /** Sub-agents by state; the card shows the total ("3 sub-agents"), the drill-in each count (AL-107). */
  readonly subAgents: SubAgentCounts;
  /** The ticket's build job and last finished build (AL-131, AL-132). */
  readonly build: AgentTicketBuild;
  /** The ticket's run (AL-133, AL-134). */
  readonly run: AgentTicketRun;
  /** The pull request the Create PR stage opened (AL-181); null before one exists. */
  readonly pullRequest: AgentTicketPullRequest | null;
}

export interface AgentTicketActivity {
  readonly text: string;
  readonly at: number;
}

export interface AgentTicketModelSwitch {
  /** The model and effort the session will use from its next turn. */
  readonly model: Model;
  readonly effort: Effort;
  readonly requestedAt: number;
}

export interface AgentTicketGate {
  /** The gated stage whose approval is awaited, e.g. `planning` ("approve plan") or `create-pr` ("approve PR"). */
  readonly stage: Stage;
  readonly openedAt: number;
}

/**
 * Why a ticket needs the user. The card turns amber and the header's "need you" pill counts it
 * (artboards 1 and 6). `approval` exists exactly while a gate waits; the gate actions keep it.
 */
export type NeedsYouReason =
  /** A stage gate waits for Approve or Request changes (AL-104). */
  | { readonly kind: 'approval'; readonly stage: Stage; readonly since: number }
  /** A tool call outside the permission policy waits for Allow or Deny (AL-109). */
  | { readonly kind: 'permission'; readonly tool: string; readonly since: number }
  /** QA found acceptance criteria that are not met ("Needs you · 1 gap"). */
  | { readonly kind: 'qa-gap'; readonly gaps: number; readonly since: number };

export type NeedsYouKind = NeedsYouReason['kind'];

/** The reasons other than `approval`, which only the gate actions set. */
export type OtherNeedsYouReason = Exclude<NeedsYouReason, { kind: 'approval' }>;
export type OtherNeedsYouKind = OtherNeedsYouReason['kind'];

/** Sub-agent states from AL-107 (Queued / Running / Done / Failed). */
export const SUB_AGENT_STATES = ['queued', 'running', 'done', 'failed'] as const;
export type SubAgentState = (typeof SUB_AGENT_STATES)[number];
export type SubAgentCounts = Readonly<Record<SubAgentState, number>>;

/** A build or run job of this ticket that is waiting or running in the build queue (AL-131). */
export interface AgentTicketBuildJob {
  readonly jobId: string;
  readonly kind: BuildJobKind;
  readonly state: 'queued' | 'running';
  /** 1-based place among waiting jobs; null while running. */
  readonly position: number | null;
}

export interface AgentTicketBuild {
  /** Null when the ticket has no job in the queue. */
  readonly job: AgentTicketBuildJob | null;
  /** The last finished build ("Build failed · 3 errors", "Last build 14:02 · succeeded"); null before any. */
  readonly last: TicketLastBuild | null;
}

export interface AgentTicketRun {
  readonly state: 'stopped' | 'running';
  /** "Running · localhost:5080" for a web project; null otherwise. */
  readonly url: string | null;
  /** When the current or last run started; null if the ticket never ran. */
  readonly startedAt: number | null;
}

export interface AgentTicketPullRequest {
  /** "PR !10612". */
  readonly id: number;
  readonly status: PullRequestStatus;
  /** "3 / 4 checks"; null while the checks are unknown. */
  readonly checks: { readonly passed: number; readonly total: number; readonly pending: number } | null;
}
