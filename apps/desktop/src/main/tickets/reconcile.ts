import { basename, join } from 'node:path';
import { z } from 'zod';
import {
  TicketIdSchema,
  err,
  ok,
  type AdoptWorktreeResult,
  type MissingWorktree,
  type OrphanWorktree,
  type Result,
  type TicketBoard,
  type TicketRecord,
} from '@agent-lanes/contracts';
import { isGitError } from '../git/git-error';
import type { GitService } from '../git/git-service';
import type { WorktreeEntry } from '../git/porcelain';
import { isSameRepoPath } from '../repos/repo-paths';
import type { SettingsService } from '../settings/service';
import { inspectPath } from '../worktrees/worktree-git';
import { errnoCode, nodeRecordFs, writeFileAtomic, type RecordFs } from './atomic-file';
import { isInsidePath } from './paths';
import type { TicketRecordStore } from './record-store';

/**
 * Start-up reconciliation (AL-090, design §6: "Agent tickets are rebuilt on start-up from the
 * worktrees and session ids the main process finds on disk"). The board is the ticket records — stage,
 * model/effort and session id as saved (AL-101) — checked against `git worktree list` for every repo:
 *
 * - a record whose worktree git no longer has, or whose folder is gone → "Worktree missing";
 * - a worktree under a repo's worktree folder that no record knows → offered as "Adopt" (a new ticket,
 *   or a sub-branch of the ticket its `<ticket>--<name>` folder names) or "Ignore" (remembered in
 *   `<userData>/ignored-worktrees.json`).
 *
 * Read-only apart from Adopt and Ignore: nothing is removed or rewritten on start-up.
 */
export interface ReconcileService {
  board(): Promise<Result<TicketBoard>>;
  adopt(worktreePath: string): Promise<Result<AdoptWorktreeResult>>;
  ignore(worktreePath: string): Promise<Result<{ ignored: string[] }>>;
}

export interface ReconcileServiceOptions {
  git: Pick<GitService, 'worktrees'>;
  settings: Pick<SettingsService, 'get'>;
  tickets: Pick<TicketRecordStore, 'list' | 'get' | 'create' | 'update' | 'issues'>;
  /** `<userData>/ignored-worktrees.json`. */
  ignoredFile: string;
  fs?: RecordFs;
  now?: () => number;
}

export const IGNORED_WORKTREES_FILE = 'ignored-worktrees.json';

export function ignoredWorktreesFile(appDataDir: string): string {
  return join(appDataDir, IGNORED_WORKTREES_FILE);
}

const IgnoredFileSchema = z.object({ version: z.literal(1), paths: z.array(z.string().min(1)) });

/** `71273--grid` → ticket `71273`, the sub-agent worktree folder AL-082/AL-084 name. */
function parentTicketOf(folder: string): string | null {
  const index = folder.indexOf('--');
  return index > 0 ? folder.slice(0, index) : null;
}

export function createReconcileService(options: ReconcileServiceOptions): ReconcileService {
  const { git, settings, tickets } = options;
  const fs = options.fs ?? nodeRecordFs;
  const now = options.now ?? Date.now;

  async function readIgnored(): Promise<string[]> {
    try {
      const parsed = IgnoredFileSchema.safeParse(JSON.parse(await fs.readFile(options.ignoredFile)));
      return parsed.success ? parsed.data.paths : [];
    } catch (cause) {
      if (errnoCode(cause) !== 'ENOENT') console.warn(`[reconcile] Could not read ${options.ignoredFile}; no worktree is ignored.`);
      return [];
    }
  }

  async function reconcile(): Promise<{ board: TicketBoard; orphanEntries: Map<string, OrphanWorktree> }> {
    const records = await tickets.list();
    const ignored = await readIgnored();
    const repos = settings.get().repos;
    const repoPaths = [...repos.map((repo) => repo.path)];
    for (const record of records) if (!repoPaths.some((path) => isSameRepoPath(path, record.repo))) repoPaths.push(record.repo);

    const lists = new Map<string, WorktreeEntry[] | null>();
    const unreadableRepos: TicketBoard['unreadableRepos'] = [];
    for (const repo of repoPaths) {
      try {
        lists.set(repo, await git.worktrees(repo));
      } catch (error) {
        lists.set(repo, null);
        unreadableRepos.push({ repo, reason: isGitError(error) ? error.message : String(error) });
      }
    }
    const listFor = (repo: string) => [...lists].find(([path]) => isSameRepoPath(path, repo))?.[1] ?? null;

    // Records whose worktree is gone.
    const missingWorktrees: MissingWorktree[] = [];
    const known: string[] = [];
    for (const record of records) {
      const list = listFor(record.repo);
      const targets = [
        { path: record.worktreePath, subBranch: null },
        ...record.subBranches.map((sub) => ({ path: sub.worktreePath, subBranch: sub.branch })),
      ];
      for (const target of targets) {
        known.push(target.path);
        const entry = list?.find((candidate) => isSameRepoPath(candidate.path, target.path));
        const folder = await inspectPath(target.path).catch(() => 'occupied' as const);
        const missing = folder === 'missing' || (list !== null && (entry === undefined || entry.prunable));
        if (missing) missingWorktrees.push({ ticketId: record.id, worktreePath: target.path, subBranch: target.subBranch });
      }
    }

    // Worktrees under our folder that no record knows.
    const ids = new Set(records.map((record) => record.id));
    const orphans: OrphanWorktree[] = [];
    const orphanEntries = new Map<string, OrphanWorktree>();
    for (const repo of repos) {
      const list = listFor(repo.path);
      if (!list) continue;
      for (const entry of list.slice(1)) {
        if (entry.bare || entry.prunable || !isInsidePath(entry.path, repo.worktreeRoot)) continue;
        if (known.some((path) => isSameRepoPath(path, entry.path))) continue;
        if (ignored.some((path) => isSameRepoPath(path, entry.path))) continue;
        const folder = basename(entry.path);
        const parent = parentTicketOf(folder);
        const parentTicketId = parent !== null && ids.has(parent) && entry.branch?.startsWith('sub/') ? parent : null;
        const ticketId = parentTicketId === null && TicketIdSchema.safeParse(folder).success && !ids.has(folder) ? folder : null;
        const orphan: OrphanWorktree = { repo: repo.path, worktreePath: entry.path, branch: entry.branch, head: entry.head, ticketId, parentTicketId };
        orphans.push(orphan);
        orphanEntries.set(entry.path, orphan);
      }
    }

    const recordIssues = (await tickets.issues()).map((issue) => ({
      kind: issue.kind,
      file: issue.file,
      ticketId: 'ticketId' in issue ? issue.ticketId : null,
    }));
    return { board: { tickets: records, missingWorktrees, orphans, recordIssues, unreadableRepos }, orphanEntries };
  }

  async function findOrphan(worktreePath: string): Promise<OrphanWorktree | undefined> {
    const { orphanEntries } = await reconcile();
    return [...orphanEntries.values()].find((orphan) => isSameRepoPath(orphan.worktreePath, worktreePath));
  }

  async function adopt(worktreePath: string): Promise<Result<AdoptWorktreeResult>> {
    const orphan = await findOrphan(worktreePath);
    if (!orphan) return err('VALIDATION', `${worktreePath} is not a worktree waiting to be adopted.`, { reason: 'not-an-orphan' });
    if (orphan.branch === null) return err('VALIDATION', `${worktreePath} has no branch checked out, so it can't be adopted.`, { reason: 'detached' });

    if (orphan.parentTicketId !== null) {
      const branch = orphan.branch;
      const name = basename(orphan.worktreePath).slice(orphan.parentTicketId.length + 2);
      const updated = await tickets.update(orphan.parentTicketId, (record): TicketRecord => ({
        ...record,
        subBranches: [...record.subBranches, { name, branch, worktreePath: orphan.worktreePath, createdAt: now(), mergedAt: null }],
      }));
      return updated.ok ? ok({ record: updated.data, adoptedAs: 'sub-branch' }) : updated;
    }

    if (orphan.ticketId === null) {
      const folder = basename(orphan.worktreePath);
      const taken = (await tickets.get(folder)) !== undefined;
      return err(
        'VALIDATION',
        taken
          ? `A ticket named ${folder} already exists. Rename the folder to adopt it as another ticket.`
          : `"${folder}" can't be used as a ticket id (lowercase letters, digits and dashes). Rename the folder to adopt it.`,
        { reason: taken ? 'ticket-exists' : 'invalid-ticket-id' },
      );
    }

    const current = settings.get();
    const repo = current.repos.find((candidate) => isSameRepoPath(candidate.path, orphan.repo));
    const created = await tickets.create({
      id: orphan.ticketId,
      title: orphan.branch,
      ado: null,
      repo: repo?.path ?? orphan.repo,
      baseBranch: repo?.baseBranch ?? 'main',
      branch: orphan.branch,
      worktreePath: orphan.worktreePath,
      model: current.defaults.model,
      effort: current.defaults.effort,
      gates: current.defaults.stageGates,
      skills: current.defaults.skills,
    });
    return created.ok ? ok({ record: created.data, adoptedAs: 'ticket' }) : created;
  }

  async function ignore(worktreePath: string): Promise<Result<{ ignored: string[] }>> {
    const orphan = await findOrphan(worktreePath);
    const ignored = await readIgnored();
    if (!orphan) return ok({ ignored });
    const paths = [...ignored, orphan.worktreePath];
    try {
      await writeFileAtomic(fs, options.ignoredFile, `${JSON.stringify({ version: 1, paths }, null, 2)}\n`);
    } catch (cause) {
      return err('INTERNAL', `Could not save the ignored worktrees: ${errnoCode(cause)}`);
    }
    return ok({ ignored: paths });
  }

  return {
    board: async () => ok((await reconcile()).board),
    adopt,
    ignore,
  };
}
