import type { AgentDefaults, Effort, Gate, Model, Stage, StageGates, WorktreePreviewSubject } from '@agent-lanes/contracts';
import { modelEffortLabel } from '@/shared/config';

/**
 * The New agent ticket form (artboard 2, AL-160): local state in a reducer (design §6), filled from
 * the agent defaults in settings when the modal opens. The work item picker (AL-161), skill chips
 * (AL-162), model cards (AL-163) and workspace preview (AL-164) each dispatch into it; Launch
 * (AL-165) takes the validated request.
 */

/** Where the work item comes from: the sprint list, a search, or none ("No ticket", `nt-…` naming). */
export const WORK_ITEM_SOURCES = ['sprint', 'search', 'none'] as const;
export type WorkItemSource = (typeof WORK_ITEM_SOURCES)[number];

/** The picked Azure DevOps work item, as its row shows it ("#71273 Cutover frmJobControl to Blazor · Story · Active"). */
export interface PickedWorkItem {
  readonly id: number;
  readonly title: string;
  readonly type?: string;
  readonly state?: string;
}

export interface NewTicketForm {
  readonly source: WorkItemSource;
  /** Null until one is picked, and always null for "No ticket". */
  readonly workItem: PickedWorkItem | null;
  /** "What should the agent do?". */
  readonly description: string;
  /** Skill names without the slash. */
  readonly skills: readonly string[];
  readonly model: Model;
  readonly effort: Effort;
  readonly gates: StageGates;
  /** The worktree folder name as the user edited it; null uses the name made from the work item (AL-164). */
  readonly worktreeName: string | null;
}

export type NewTicketAction =
  | { type: 'reset'; defaults: AgentDefaults }
  | { type: 'source'; source: WorkItemSource }
  | { type: 'workItem'; workItem: PickedWorkItem | null }
  | { type: 'description'; description: string }
  | { type: 'skill'; skill: string; selected: boolean }
  | { type: 'model'; model: Model }
  | { type: 'effort'; effort: Effort }
  | { type: 'gate'; stage: Stage; gate: Gate }
  | { type: 'worktreeName'; name: string | null };

export function initialForm(defaults: AgentDefaults): NewTicketForm {
  return {
    source: 'sprint',
    workItem: null,
    description: '',
    skills: [...defaults.skills],
    model: defaults.model,
    effort: defaults.effort,
    gates: { ...defaults.stageGates },
    worktreeName: null,
  };
}

export function newTicketReducer(form: NewTicketForm, action: NewTicketAction): NewTicketForm {
  switch (action.type) {
    case 'reset':
      return initialForm(action.defaults);
    case 'source':
      // "No ticket" drops the picked item; Sprint and Search share it.
      return { ...form, source: action.source, workItem: action.source === 'none' ? null : form.workItem };
    case 'workItem':
      return { ...form, workItem: form.source === 'none' ? null : action.workItem };
    case 'description':
      return { ...form, description: action.description };
    case 'skill': {
      const has = form.skills.includes(action.skill);
      if (has === action.selected) return form;
      return { ...form, skills: action.selected ? [...form.skills, action.skill] : form.skills.filter((skill) => skill !== action.skill) };
    }
    case 'model':
      return { ...form, model: action.model };
    case 'effort':
      return { ...form, effort: action.effort };
    case 'gate':
      return { ...form, gates: { ...form.gates, [action.stage]: action.gate } };
    case 'worktreeName':
      return { ...form, worktreeName: action.name };
  }
}

export type NewTicketField = 'workItem' | 'description' | 'worktree';
export type NewTicketErrors = Partial<Record<NewTicketField, string>>;

/** The longest job description sent as the agent's first turn. */
export const DESCRIPTION_MAX_LENGTH = 20_000;

/** What stops Launch, field by field. Empty when the agent can launch. */
export function validateForm(form: NewTicketForm): NewTicketErrors {
  const errors: NewTicketErrors = {};
  const description = form.description.trim();
  if (form.source !== 'none' && !form.workItem) errors.workItem = 'Pick a work item, or choose No ticket.';
  if (form.source === 'none' && !description) errors.description = 'Describe the job: a ticket without a work item starts from this.';
  if (form.description.length > DESCRIPTION_MAX_LENGTH) {
    errors.description = `Keep the description under ${DESCRIPTION_MAX_LENGTH.toLocaleString('en')} characters.`;
  }
  return errors;
}

/** What Launch (AL-165) receives from a valid form. */
export interface NewTicketRequest {
  readonly workItem: PickedWorkItem | null;
  readonly description: string;
  readonly skills: readonly string[];
  readonly model: Model;
  readonly effort: Effort;
  readonly gates: StageGates;
  /** The branch name as the user edited it (validated by the workspace preview); null uses the generated name. */
  readonly worktreeName: string | null;
  /** The repo the workspace preview showed (the board's repo); null when none is registered. */
  readonly repo: string | null;
}

/** The launch request, or the errors that block it. */
export function launchRequest(
  form: NewTicketForm,
  repo: string | null = null,
): { ok: true; request: NewTicketRequest } | { ok: false; errors: NewTicketErrors } {
  const errors = validateForm(form);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    request: {
      workItem: form.source === 'none' ? null : form.workItem,
      description: form.description.trim(),
      skills: [...form.skills],
      model: form.model,
      effort: form.effort,
      gates: { ...form.gates },
      // Exactly what the workspace preview validated; launch validates it again (AL-083).
      worktreeName: form.worktreeName,
      repo,
    },
  };
}

/**
 * The footer line (artboard 2): "Launch starts a headless Claude Code session in its own worktree via
 * the MCP bridge. Linked to #71273. Opus · XHigh."
 */
export function launchSummary(form: NewTicketForm): string {
  const link = form.source === 'none' ? 'No work item linked.' : form.workItem ? `Linked to #${form.workItem.id}.` : 'No work item picked yet.';
  return `Launch starts a headless Claude Code session in its own worktree via the MCP bridge. ${link} ${modelEffortLabel(form.model, form.effort)}.`;
}

/**
 * What the workspace preview names the worktree after (AL-164): the picked work item, the job
 * description for "No ticket", or nothing yet.
 */
export function worktreeSubject(form: Pick<NewTicketForm, 'source' | 'workItem' | 'description'>): WorktreePreviewSubject | null {
  if (form.source === 'none') return { kind: 'no-ticket', description: form.description };
  return form.workItem ? { kind: 'work-item', workItemId: form.workItem.id, title: form.workItem.title } : null;
}
