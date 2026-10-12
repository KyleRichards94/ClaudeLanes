import { STAGES, type AssignAgentMode, type Lane, type Stage, type TicketCompanionRole } from '@agent-lanes/contracts';

/** The Context control's options: hand over (the default, Kyle 2026-10-09) or start fresh. */
export const ASSIGN_MODE_OPTIONS: readonly { value: AssignAgentMode; label: string }[] = [
  { value: 'hand-over', label: 'Hand over' },
  { value: 'fresh', label: 'Start fresh' },
];

/** Fork from here (AL-265): offered only when the dialog opened from a message. */
export const FORK_MODE_OPTION = { value: 'fork', label: 'Start from fork' } as const;

export const ASSIGN_MODE_HELP: Readonly<Record<AssignAgentMode, string>> = {
  'hand-over': "The new agent's first turn is a brief: the ticket, the original job, its stages, the changes against the base branch and the previous agent's last messages.",
  fresh: 'The new agent gets the original job again and nothing else; it reads the worktree itself.',
  fork: "The new agent continues a copy of this session that ends at the message you picked; everything after it is left behind.",
};

/** Add agent (AL-266): the Role control's options. */
export const COMPANION_ROLE_OPTIONS: readonly { value: TicketCompanionRole; label: string }[] = [
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'helper', label: 'Helper' },
];

export const COMPANION_ROLE_HELP: Readonly<Record<TicketCompanionRole, string>> = {
  reviewer: "Reads the ticket worktree beside the lead agent, read-only: its edits and worktree-changing commands are refused. It reports in its replies.",
  helper: "Works on its own sub-branch and worktree (sub/<ticket>-<name>); its commits show in Sub-branches and merge like a writer sub-agent's.",
};

export function defaultCompanionName(role: TicketCompanionRole): string {
  return role === 'reviewer' ? 'Reviewer' : 'Helper';
}

export function defaultCompanionPrompt(role: TicketCompanionRole): string {
  return role === 'reviewer'
    ? "Review the changes on this ticket against its job: correctness, tests, and anything the lead agent missed. Report findings in your reply, most important first, with file and line."
    : '';
}

/** Skill names typed with or without the slash, separated by spaces or commas; each once. */
export function parseSkillNames(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((part) => part.trim().replace(/^\//, '')).filter(Boolean))];
}

export function formatSkills(skills: readonly string[]): string {
  return skills.map((skill) => `/${skill}`).join(' ');
}

/** The stage the new agent starts from: the ticket's own, or Planning for a queued or done ticket. */
export function defaultStage(lane: Lane | undefined): Stage {
  return lane && (STAGES as readonly string[]).includes(lane) ? (lane as Stage) : 'planning';
}
