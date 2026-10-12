import { err, ok, type RewindRequest, type RewindResponse, type Result } from '@agent-lanes/contracts';
import type { GitService } from '../git/git-service';
import type { Logger } from '../logging';
import type { TicketRecordStore } from '../tickets';
import type { TranscriptService } from './output/transcript';
import type { SessionManager } from './session-manager';

/**
 * Rewind to here (AL-265): the SDK restores the worktree's tracked files to how they were at one of
 * the user's messages (`rewindFiles`, file checkpointing on). A dry run previews the files; the real
 * rewind writes a line to the output. Refused when commits made after that message have already been
 * pushed: those are on the remote and a rewind would only hide them locally.
 */
export interface RewindService {
  rewind(request: RewindRequest): Promise<Result<RewindResponse>>;
}

export interface RewindServiceOptions {
  sessions: Pick<SessionManager, 'rewindFiles'>;
  tickets: Pick<TicketRecordStore, 'get'>;
  transcripts: Pick<TranscriptService, 'get' | 'appendSystem'>;
  git: Pick<GitService, 'run'>;
  userName?: () => string;
  log?: Pick<Logger, 'info' | 'warn'>;
}

export const REWIND_PUSHED_REASON = 'pushed-commits';

function clock(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function createRewindService(options: RewindServiceOptions): RewindService {
  const userName = options.userName ?? (() => 'You');

  /** Commits on the ticket branch since `at` that origin already has. */
  async function pushedSince(worktree: string, branch: string, at: number): Promise<string[]> {
    const remote = await options.git.run(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`], { cwd: worktree, allowedExitCodes: [1] });
    if (remote.exitCode !== 0) return [];
    const log = await options.git.run(['log', '--format=%H', `--since=${new Date(at).toISOString()}`, `refs/remotes/origin/${branch}`], { cwd: worktree, allowedExitCodes: [128] });
    return log.exitCode === 0 ? log.stdout.split(/\r?\n/).filter(Boolean) : [];
  }

  return {
    async rewind({ ticketId, messageId, dryRun = false }) {
      const record = await options.tickets.get(ticketId);
      if (!record) return err('VALIDATION', `There is no ticket ${ticketId}.`);
      const message = (await options.transcripts.get(ticketId)).events.find((event) => event.item.kind === 'user' && event.item.messageId === messageId);
      if (!message) return err('VALIDATION', 'That message is no longer in the output.', { reason: 'message-unknown' });
      if (message.at > 0) {
        let pushed: string[] = [];
        try {
          pushed = await pushedSince(record.worktreePath, record.branch, message.at);
        } catch (error) {
          options.log?.warn(`Could not check pushed commits for ticket ${ticketId}: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (pushed.length > 0) {
          return err('VALIDATION', `${pushed.length} ${pushed.length === 1 ? 'commit' : 'commits'} made after that message ${pushed.length === 1 ? 'is' : 'are'} already pushed to origin/${record.branch}. Revert them there instead of rewinding.`, { reason: REWIND_PUSHED_REASON, commits: pushed.slice(0, 20) });
        }
      }
      const result = await options.sessions.rewindFiles(ticketId, messageId, { dryRun });
      if (!result.ok) return result;
      const outcome = result.data;
      const response: RewindResponse = {
        canRewind: outcome.canRewind,
        error: outcome.error ?? null,
        filesChanged: outcome.filesChanged ?? [],
        insertions: outcome.insertions ?? 0,
        deletions: outcome.deletions ?? 0,
        dryRun,
      };
      if (!dryRun && outcome.canRewind) {
        const files = response.filesChanged.length;
        options.transcripts.appendSystem(ticketId, `${userName()} rewound the worktree to ${message.at > 0 ? clock(message.at) : 'an earlier message'} · ${files} ${files === 1 ? 'file' : 'files'} restored (+${response.insertions} −${response.deletions})`);
        options.log?.info(`Ticket ${ticketId}: rewound ${files} files to message ${messageId}`);
      }
      return ok(response);
    },
  };
}
