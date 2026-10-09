import { STAGES, type AssignAgentMode, type Lane, type Stage } from '@agent-lanes/contracts';

/** The Context control's options: hand over (the default, Kyle 2026-10-09) or start fresh. */
export const ASSIGN_MODE_OPTIONS: readonly { value: AssignAgentMode; label: string }[] = [
  { value: 'hand-over', label: 'Hand over' },
  { value: 'fresh', label: 'Start fresh' },
];

export const ASSIGN_MODE_HELP: Readonly<Record<AssignAgentMode, string>> = {
  'hand-over': "The new agent's first turn is a brief: the ticket, the original job, its stages, the changes against the base branch and the previous agent's last messages.",
  fresh: 'The new agent gets the original job again and nothing else; it reads the worktree itself.',
};

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
