import { err, ok, type DiffFilesResponse, type Result, type ReviewFinding, type TicketRecord } from '@agent-lanes/contracts';
import { replayAttribution, type AttributionMap } from '../agent/attribution/attribution';
import type { TranscriptService } from '../agent/output/transcript';
import { findingsOf, replayReview, reviewStatusOf, type ReviewReplay } from '../agent/review/findings';
import type { GitService } from '../git/git-service';
import type { Logger } from '../logging';
import type { TicketRecordStore } from '../tickets';
import type { DiffService } from '../worktrees/diff';
import { toChangedFiles, uncommittedPaths } from './changed-files';

/**
 * The changed-files and review-findings channels (AL-276, AL-277): `git:diff`'s file list for the
 * ticket against its base, with each file's author agent, whether it is uncommitted and its review
 * status; and the reviewer's findings. Authors and findings are replayed from the ticket's transcripts
 * (the lead's and its second agents'), which the transcript service reads back from the saved
 * sessions after a restart, so nothing is stored. The replay is cached per ticket until a transcript
 * moves on.
 */
export interface ChangesService {
  files(ticketId: string): Promise<Result<DiffFilesResponse>>;
  findings(ticketId: string): Promise<Result<ReviewFinding[]>>;
}

export interface ChangesServiceOptions {
  diffs: Pick<DiffService, 'files'>;
  git: Pick<GitService, 'status'>;
  tickets: Pick<TicketRecordStore, 'get' | 'list'>;
  transcripts: Pick<TranscriptService, 'get'>;
  log?: Pick<Logger, 'warn'>;
}

interface Replay {
  /** What the replay was built from; the same key means the same result. */
  key: string;
  attribution: AttributionMap;
  review: ReviewReplay;
}

/** The lead is reviewing in these lanes, so its file reads show a file in review. */
const REVIEW_LANES: ReadonlySet<string> = new Set(['code-review', 'review-only']);

function notFound(ticketId: string): Result<never> {
  return err('VALIDATION', `There is no ticket ${ticketId}.`, { reason: 'ticket-not-found', ticketId });
}

export function createChangesService(options: ChangesServiceOptions): ChangesService {
  const { diffs, git, tickets, transcripts } = options;
  const cache = new Map<string, Replay>();

  async function replayOf(lead: TicketRecord): Promise<Replay> {
    const companions = (await tickets.list({ repo: lead.repo })).filter((record) => record.companion?.of === lead.id);
    const members = [
      { record: lead, reviewing: REVIEW_LANES.has(lead.stage) },
      ...companions.map((record) => ({ record, reviewing: record.companion?.role === 'reviewer' })),
    ];
    const loaded = await Promise.all(members.map(async (member) => ({ ...member, transcript: await transcripts.get(member.record.id) })));
    // A transcript moves on with a new live event (`lastSeq`) or when its history is read back (its length).
    const key = loaded.map(({ record, reviewing, transcript }) => `${record.id}:${reviewing ? 1 : 0}:${transcript.lastSeq}:${transcript.events.length}`).join('|');
    const cached = cache.get(lead.id);
    if (cached?.key === key) return cached;

    const sources = loaded.map(({ record, reviewing, transcript }) => ({ agentId: record.id, events: transcript.events, cwd: record.worktreePath, reviewing }));
    const replay: Replay = { key, attribution: replayAttribution(sources), review: replayReview(sources) };
    cache.set(lead.id, replay);
    return replay;
  }

  /** Paths git lists as changed in the worktree; none when git cannot say. */
  async function uncommittedOf(record: TicketRecord): Promise<Set<string>> {
    try {
      return uncommittedPaths(await git.status(record.worktreePath, { untracked: 'all' }));
    } catch (error) {
      options.log?.warn(`Could not read the working tree of ticket ${record.id}: ${error instanceof Error ? error.message : String(error)}`);
      return new Set();
    }
  }

  return {
    async files(ticketId) {
      const record = await tickets.get(ticketId);
      if (!record) return notFound(ticketId);
      try {
        const diff = await diffs.files(ticketId, { kind: 'base' });
        if (!diff.ok) return diff;
        const [uncommitted, replay] = await Promise.all([diff.data.includesUncommitted ? uncommittedOf(record) : new Set<string>(), replayOf(record)]);
        const files = toChangedFiles(diff.data.files, replay.attribution, uncommitted);
        return ok({
          ticketId,
          base: diff.data.fromRef,
          head: diff.data.toRef,
          files,
          truncated: diff.data.truncated,
          reviewStatus: Object.fromEntries(files.map((file) => [file.path, reviewStatusOf(replay.review, file.path)])),
        });
      } catch (error) {
        options.log?.warn(`Could not list the changed files of ticket ${ticketId}: ${error instanceof Error ? error.message : String(error)}`);
        return err('INTERNAL', `Could not list the changed files: ${error instanceof Error ? error.message : String(error)}`, { reason: 'changes-failed' });
      }
    },

    async findings(ticketId) {
      const record = await tickets.get(ticketId);
      if (!record) return notFound(ticketId);
      try {
        return ok(findingsOf((await replayOf(record)).review));
      } catch (error) {
        options.log?.warn(`Could not read the review findings of ticket ${ticketId}: ${error instanceof Error ? error.message : String(error)}`);
        return err('INTERNAL', `Could not read the review findings: ${error instanceof Error ? error.message : String(error)}`, { reason: 'changes-failed' });
      }
    },
  };
}
