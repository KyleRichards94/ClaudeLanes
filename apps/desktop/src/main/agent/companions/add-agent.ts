import { TICKET_ID_MAX_LENGTH, err, ok, type AddAgentRequest, type AddAgentResponse, type Result, type TicketCompanionRole, type TicketRecord } from '@agent-lanes/contracts';
import type { Logger } from '../../logging';
import type { TicketRecordStore } from '../../tickets';
import type { SubWorktreeService } from '../../worktrees/sub-worktree';
import type { LaunchQueue } from '../launch-queue';
import type { TranscriptService } from '../output/transcript';
import { REVIEW_FINDINGS_INSTRUCTION } from '../review/findings';

/**
 * Add agent (AL-266, Kyle 2026-10-09: a ticket may run a second agent). A companion is a ticket
 * record of its own, marked `companion: { of, role, name }`, so sessions, output, usage, permissions
 * and Stop all work by its id as they do for any ticket; the board hides it and the drill-in of its
 * lead switches to it. A **reviewer** shares the lead's worktree and branch and is read-only (the
 * permission service denies its write tools); a **helper** gets `sub/<ticket>-<name>` and its own
 * worktree through the sub-worktree service, so its commits show in Sub-branches and merge like any
 * writer sub-agent's. A companion counts against the repo's concurrency cap like any session.
 */
export interface AddAgentService {
  add(request: AddAgentRequest): Promise<Result<AddAgentResponse>>;
}

export interface AddAgentOptions {
  tickets: Pick<TicketRecordStore, 'get' | 'create' | 'update' | 'delete'>;
  launches: Pick<LaunchQueue, 'launch'>;
  subWorktrees: Pick<SubWorktreeService, 'create'>;
  transcripts?: Pick<TranscriptService, 'appendSystem'>;
  log?: Pick<Logger, 'info' | 'warn'>;
}

export const COMPANION_ROLE_WORDS: Readonly<Record<TicketCompanionRole, string>> = { reviewer: 'Reviewer', helper: 'Helper' };

/** `71273-reviewer-second-pair-of-eyes`: the lead's id, the role and the name made id-safe. */
export function companionId(leadId: string, role: TicketCompanionRole, name: string): string {
  const prefix = `${leadId}-${role}`;
  const slug = companionSlug(name)
    .slice(0, Math.max(1, TICKET_ID_MAX_LENGTH - prefix.length - 1))
    .replace(/-+$/, '');
  return slug ? `${prefix}-${slug}` : prefix;
}

/** The name as a branch and id part: lower case, letters and digits, dashes between. */
export function companionSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The companion's first turn: who it is, where it works, what the ticket is about, and its own task. */
export function companionBrief(lead: TicketRecord, role: TicketCompanionRole, name: string, prompt: string, place: { worktreePath: string; branch: string }): string {
  const ticket = lead.ado ? `work item #${lead.ado.workItemId} "${lead.title}"` : `ticket ${lead.id} "${lead.title}"`;
  const sections = [
    role === 'reviewer'
      ? `You are the reviewer "${name}" on ${ticket}, working beside its lead agent, which keeps working in the same worktree. You share the lead's worktree at ${place.worktreePath} on branch ${place.branch}. You are read-only: you cannot edit files, and shell commands that change the worktree are refused; reading files, git reads and the repo's build and test commands are allowed. Report what you find, and what you would change, in your replies. ${REVIEW_FINDINGS_INSTRUCTION}`
      : `You are the helper "${name}" on ${ticket}, working beside its lead agent. You have your own worktree at ${place.worktreePath} on branch ${place.branch}, branched from the ticket branch ${lead.branch}. Commit your work on your branch; the lead agent or the user merges it into the ticket branch, so do not merge or push it yourself.`,
    ...(lead.job ? [`The ticket's original job, which the lead agent works on:\n${lead.job.trim()}`] : []),
    `Your task:\n${prompt.trim()}`,
  ];
  return sections.join('\n\n');
}

export function createAddAgentService(options: AddAgentOptions): AddAgentService {
  return {
    async add(request) {
      const lead = await options.tickets.get(request.ticketId);
      if (!lead) return err('VALIDATION', `There is no ticket ${request.ticketId}.`);
      if (lead.companion) {
        return err('VALIDATION', `${lead.companion.name} is itself a second agent on #${lead.companion.of}; add agents to the ticket, not to its companions.`, { reason: 'not-a-lead' });
      }
      const name = request.name.trim();
      if (!companionSlug(name)) return err('VALIDATION', 'Give the agent a name with a letter or a digit in it.', { reason: 'invalid-name' });
      const id = companionId(lead.id, request.role, name);
      if (await options.tickets.get(id)) {
        return err('VALIDATION', `There is already a ${request.role} called "${name}" on this ticket. Pick another name.`, { reason: 'name-taken', companionId: id });
      }

      // Where it works: the lead's worktree, or a sub-branch and worktree of its own (AL-084).
      let place: { worktreePath: string; branch: string };
      if (request.role === 'reviewer') {
        place = { worktreePath: lead.worktreePath, branch: lead.branch };
      } else {
        const sub = await options.subWorktrees.create(lead.id, companionSlug(name));
        if (!sub.ok) return err(sub.code, `The helper's worktree could not be created: ${sub.message}`, sub.details);
        place = { worktreePath: sub.data.worktreePath, branch: sub.data.branch };
      }

      const created = await options.tickets.create({
        id,
        title: `${name} · ${lead.title}`,
        ado: null,
        repo: lead.repo,
        // A helper merges back into the ticket branch; a reviewer reads the ticket branch against its base.
        baseBranch: request.role === 'helper' ? lead.branch : lead.baseBranch,
        branch: place.branch,
        worktreePath: place.worktreePath,
        model: request.model,
        effort: request.effort,
        // A companion never waits on a stage gate: its record is not on the board.
        gates: { planning: 'auto', implementing: 'auto', 'code-review': 'auto', qa: 'auto', 'create-pr': 'auto' },
        skills: request.skills,
        stage: lead.stage === 'queued' || lead.stage === 'done' ? 'planning' : lead.stage,
        companion: { of: lead.id, role: request.role, name },
      });
      if (!created.ok) return err(created.code, `The agent's record could not be saved: ${created.message}`, created.details);
      await options.tickets.update(id, (record) => ({ ...record, job: request.prompt }));

      const started = await options.launches.launch({
        ticketId: id,
        jobDescription: companionBrief(lead, request.role, name, request.prompt, place),
        workItem: lead.ado ? { id: lead.ado.workItemId, title: lead.title } : null,
        firstTurnSource: 'launch',
        // The Output tab shows the task; the brief around it is the app's.
        firstTurnEcho: request.prompt,
      });
      if (!started.ok) {
        await options.tickets.delete(id);
        options.log?.warn(`Ticket ${lead.id}: the ${request.role} "${name}" could not start: ${started.message}`);
        return started;
      }
      options.transcripts?.appendSystem(lead.id, `${COMPANION_ROLE_WORDS[request.role]} "${name}" added${request.role === 'helper' ? ` on ${place.branch}` : ''}`);
      options.log?.info(`Ticket ${lead.id}: ${request.role} "${name}" runs as ${id}${request.role === 'helper' ? ` on ${place.branch}` : ' in the ticket worktree'}.`);
      return ok({ companionId: id, status: started.data });
    },
  };
}
