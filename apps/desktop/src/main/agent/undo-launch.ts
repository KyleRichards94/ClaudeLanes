import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { LAUNCH_UNDO_WINDOW_MS, UNDO_GRACE_MS, err, ok, type Err, type Result, type UndoLaunchResponse, type UndoRefusal } from '@agent-lanes/contracts';
import type { AdoService } from '../ado';
import type { Emit } from '../ipc/emit';
import type { Logger } from '../logging';
import type { TicketWorktreeService } from '../worktrees';
import { launchToastId, restoreAssignment, type AdoLauncher, type LaunchUndoEntry } from './launch-from-ado';
import type { LaunchQueue } from './launch-queue';
import type { SessionManager } from './session-manager';

/**
 * Undo a team board launch (AL-237, T8, TB§4): for 10 s, or until the agent's first turn ends, Undo puts
 * everything back: the work item's assignee and state, the worktree and branch, the ticket, and the
 * session. Once the agent has pushed, or a review agent has posted comments, there is something Undo
 * can't take back: it is no longer offered and the toast says what to revert by hand.
 */
export interface LaunchUndo {
  undo(undoId: string): Promise<Result<UndoLaunchResponse>>;
  /** Stops watching sessions. */
  dispose(): void;
}

export interface LaunchUndoOptions {
  launcher: Pick<AdoLauncher, 'undoEntry' | 'forgetUndo' | 'undoEntryForTicket'>;
  sessions: Pick<SessionManager, 'stop' | 'subscribe'>;
  launches: Pick<LaunchQueue, 'cancel'>;
  worktrees: Pick<TicketWorktreeService, 'discard'>;
  ado: Pick<AdoService, 'clientFor'>;
  emit: Emit;
  log?: Pick<Logger, 'info' | 'warn'>;
  now?: () => number;
}

/** What to put back by hand once Undo can't: "set #71318 back to Failed UAT and unassign it in Azure DevOps, then archive 71318 to remove its worktree." */
export function revertByHand(entry: LaunchUndoEntry): string {
  const steps: string[] = [];
  if (entry.ado) {
    const who = entry.ado.previousAssignee ? `assign it to ${entry.ado.previousAssignee.displayName}` : 'unassign it';
    steps.push(`set #${entry.ado.workItemId} back to ${entry.ado.previousState} and ${who} in Azure DevOps`);
  }
  steps.push(`archive ${entry.ticketId} to remove its worktree`);
  return `${steps.join(', then ')}.`;
}

/** A Bash push, or a write to a PR's threads through an MCP tool, the `az` CLI or a script. */
function irreversibleStep(message: SDKMessage): 'pushed' | 'commented' | null {
  if (message.type !== 'assistant') return null;
  const content = (message.message as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  for (const block of content as Array<{ type?: string; name?: string; input?: { command?: unknown } }>) {
    if (block.type !== 'tool_use') continue;
    const command = typeof block.input?.command === 'string' ? block.input.command : '';
    if (block.name === 'Bash' && /\bgit\s+push\b/.test(command)) return 'pushed';
    if (block.name === 'Bash' && /\baz\s+repos\s+pr\b/.test(command)) return 'commented';
    // An MCP tool that writes to a thread or comment (`repo_create_pull_request_thread`, `repo_reply_to_comment`, …); reads don't count.
    if (block.name?.startsWith('mcp__') && /comment|thread/i.test(block.name) && /create|add|reply|update|resolve|post|edit|delete/i.test(block.name)) return 'commented';
  }
  return null;
}

export function createLaunchUndo(options: LaunchUndoOptions): LaunchUndo {
  const { launcher, sessions, launches, worktrees, ado, emit, log } = options;
  const now = options.now ?? Date.now;
  /** Launches Undo can no longer take back, and why. */
  const closed = new Map<string, { reason: UndoRefusal; message: string }>();

  function refuse(reason: UndoRefusal, message: string): Err {
    return err('VALIDATION', message, { reason });
  }

  function close(entry: LaunchUndoEntry, reason: UndoRefusal, message: string): void {
    if (closed.has(entry.undoId)) return;
    closed.set(entry.undoId, { reason, message });
    // While its toast still shows Undo, the toast says why it went and what to revert by hand.
    if (now() - entry.createdAt <= LAUNCH_UNDO_WINDOW_MS) {
      emit('toast', { id: launchToastId(entry.ticketId), tone: reason === 'turn-ended' ? 'info' : 'warning', title: 'Undo is no longer available', body: message });
    }
  }

  const unsubscribe = sessions.subscribe(({ ticketId, message }) => {
    const entry = launcher.undoEntryForTicket(ticketId);
    if (!entry || closed.has(entry.undoId)) return;
    const step = irreversibleStep(message);
    if (step === 'pushed') close(entry, 'pushed', `The agent already pushed its branch. To revert by hand: delete the branch on origin, ${revertByHand(entry)}`);
    else if (step === 'commented') close(entry, 'commented', `The agent already posted to Azure DevOps. Resolve or delete what it posted, then ${revertByHand(entry)}`);
    else if (message.type === 'result') close(entry, 'turn-ended', `The agent finished its first turn. To take the launch back: ${revertByHand(entry)}`);
  });

  async function undo(undoId: string): Promise<Result<UndoLaunchResponse>> {
    const entry = launcher.undoEntry(undoId);
    if (!entry) return refuse('expired', 'Undo is no longer available for this launch.');
    const stop = closed.get(undoId);
    if (stop) return refuse(stop.reason, stop.message);
    if (now() - entry.createdAt > LAUNCH_UNDO_WINDOW_MS + UNDO_GRACE_MS) {
      launcher.forgetUndo(undoId);
      return refuse('expired', `Undo ended after ${LAUNCH_UNDO_WINDOW_MS / 1000} s. To take the launch back: ${revertByHand(entry)}`);
    }
    launcher.forgetUndo(undoId);
    closed.delete(undoId);

    // The session first, so nothing writes to the worktree while it goes.
    launches.cancel(entry.ticketId);
    await sessions.stop(entry.ticketId);
    const discarded = await worktrees.discard(entry.ticketId);
    const leftovers = discarded.ok ? discarded.data.leftovers : [discarded.message];

    let adoRestored: boolean | null = null;
    let adoProblem: string | null = null;
    if (entry.ado) {
      const client = await ado.clientFor(entry.org);
      const restored = client.ok ? await restoreAssignment(client.data, entry.ado) : client;
      adoRestored = restored.ok;
      if (!restored.ok) adoProblem = restored.message;
    }

    const parts: string[] = [];
    if (entry.ado) {
      parts.push(
        adoRestored
          ? `#${entry.ado.workItemId} is back in ${entry.ado.previousState}${entry.ado.previousAssignee ? `, assigned to ${entry.ado.previousAssignee.displayName}` : ', unassigned'}`
          : `#${entry.ado.workItemId} could not be put back (${adoProblem ?? 'unknown error'}): set it back by hand`,
      );
    }
    parts.push(leftovers.length === 0 ? 'the worktree and agent are gone' : `left behind: ${leftovers.join(', ')}`);
    log?.info(`Undid the launch of ${entry.ticketId}${leftovers.length > 0 ? ` (left ${leftovers.join(', ')})` : ''}`);
    return ok({ ticketId: entry.ticketId, worktreeRemoved: leftovers.length === 0, leftovers, adoRestored, summary: parts.join(' · ') });
  }

  return {
    undo: (undoId) => undo(undoId).catch((cause: unknown) => err('INTERNAL', `Undo failed: ${cause instanceof Error ? cause.message : String(cause)}`)),
    dispose: unsubscribe,
  };
}
