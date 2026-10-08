import { err, ok, type LaunchTicketRequest, type LaunchTicketResponse, type Result, type TicketRecord } from '@agent-lanes/contracts';
import type { AdoService } from '../ado';
import type { SessionWorkItem } from '../agent/first-turn';
import type { LaunchQueue } from '../agent/launch-queue';
import type { Logger } from '../logging';
import type { TicketWorktreeService } from '../worktrees';
import type { TicketRecordStore } from './record-store';

/**
 * Launch (AL-165, design §9 step 1): the New agent ticket modal's "Launch agent →".
 *
 * 1. Reads the picked work item from Azure DevOps again: its organisation and project for the ticket
 *    record, and its description and acceptance criteria for the agent's first turn.
 * 2. Creates the worktree and branch and writes the ticket record (AL-083); the card starts in Queued.
 * 3. Starts the session through the launch queue (AL-111): it moves the card to Planning as it starts
 *    (AL-103), or the ticket waits in Queued when its repo is at the cap.
 *
 * A session that can't start takes the worktree, branch and record back with it, so a failed launch
 * leaves nothing behind; the error says why, for the recovery toast (AL-211).
 */
export interface TicketLauncher {
  launch(request: LaunchTicketRequest): Promise<Result<LaunchTicketResponse>>;
}

export interface TicketLauncherOptions {
  ado: Pick<AdoService, 'clientFor' | 'getWorkItem'>;
  worktrees: Pick<TicketWorktreeService, 'create' | 'discard'>;
  launches: Pick<LaunchQueue, 'launch'>;
  tickets: Pick<TicketRecordStore, 'get'>;
  log?: Pick<Logger, 'info' | 'warn'>;
}

/** The job a work item ticket gets when the user left "What should the agent do?" empty. */
export function defaultWorkItemJob(workItemId: number): string {
  return `Work on #${workItemId} as its description and acceptance criteria say: plan the change, then build it.`;
}

/** The work item text for the first turn: description, then acceptance criteria (both ADO HTML). */
function workItemText(description: string | null, acceptanceCriteria: string | null): string | null {
  const parts = [description, acceptanceCriteria ? `<p>Acceptance criteria:</p>${acceptanceCriteria}` : null].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join('\n') : null;
}

export function createTicketLauncher(options: TicketLauncherOptions): TicketLauncher {
  const { ado, worktrees, launches, tickets, log } = options;

  return {
    async launch(request) {
      let sessionItem: SessionWorkItem | null = null;
      let subject: Parameters<TicketWorktreeService['create']>[0]['subject'];
      if (request.workItem) {
        const read = await ado.getWorkItem({ id: request.workItem.id });
        if (!read.ok) return read;
        const client = await ado.clientFor();
        if (!client.ok) return client;
        const item = read.data;
        sessionItem = { id: item.id, title: item.title, type: item.type, state: item.state, description: workItemText(item.description, item.acceptanceCriteria) };
        subject = { kind: 'work-item', ado: { orgUrl: client.data.orgUrl, project: item.project, workItemId: item.id }, title: item.title };
      } else {
        subject = { kind: 'no-ticket', description: request.description };
      }

      const created = await worktrees.create({
        repo: request.repo,
        subject,
        ...(request.worktreeName === null ? {} : { branch: request.worktreeName }),
        model: request.model,
        effort: request.effort,
        gates: request.gates,
        skills: [...request.skills],
        stage: 'queued',
      });
      if (!created.ok) return created;
      const ticketId = created.data.record.id;

      const jobDescription = request.description.trim() || (sessionItem ? defaultWorkItemJob(sessionItem.id) : '');
      const started = await launches.launch({ ticketId, jobDescription, workItem: sessionItem }).catch((cause: unknown) =>
        err('INTERNAL', cause instanceof Error ? cause.message : String(cause)),
      );
      if (!started.ok) {
        // Nothing half-made stays: the worktree, its branch and the record go (D386).
        const rollback = await worktrees.discard(ticketId);
        log?.warn(`Launch of ${ticketId} failed (${started.message}); ${rollback.ok && rollback.data.complete ? 'rolled back' : 'rollback incomplete'}`);
        return err(started.code, started.message, {
          ...(isRecord(started.details) ? started.details : {}),
          reason: isRecord(started.details) && typeof started.details['reason'] === 'string' ? started.details['reason'] : 'session-failed',
          ticketId,
          rollback: rollback.ok ? rollback.data : { complete: false, leftovers: [rollback.message] },
        });
      }

      // The session moved the card to Planning as it started (AL-103); a queued one is still in Queued.
      const record: TicketRecord = (await tickets.get(ticketId)) ?? created.data.record;
      log?.info(`Launched ${ticketId} (${started.data.state})`);
      return ok({ record, status: started.data });
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
