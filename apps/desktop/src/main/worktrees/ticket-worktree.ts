import { readdir } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';
import {
  TicketAdoRefSchema,
  err,
  ok,
  type Effort,
  type Err,
  type Lane,
  type Model,
  type Result,
  type StageGates,
  type TicketAdoRef,
  type TicketRecord,
  type WorktreePreview,
  type WorktreePreviewRequest,
} from '@agent-lanes/contracts';
import { isGitError } from '../git/git-error';
import type { CallOptions } from '../git/git-service';
import { nameNoTicket, nameWorkItemTicket } from '../git/naming/branch-names';
import { checkBranchName, validateBranchName, type CheckRefFormat } from '../git/naming/check-branch-name';
import { isSameRepoPath, repoPathKey } from '../repos/repo-paths';
import type { SettingsService } from '../settings/service';
import type { TicketRecordStore } from '../tickets/record-store';
import { createKeyedQueue } from './keyed-queue';
import {
  addWorktree,
  fetchBase,
  findRegisteredWorktree,
  inspectPath,
  listBranchNames,
  resolveStart,
  undoWorktreeAdd,
  type RollbackReport,
  type WorktreeGit,
  type WorktreeStart,
} from './worktree-git';

/**
 * Creates a ticket's worktree and records it on the ticket (AL-083, design §9 step 1, R8):
 *
 * 1. Names the ticket (AL-082): work item `71273` → branch `71273-cutover-frmjobcontrol-to` in
 *    `<root>/71273`; no work item → `nt-<yyyymmdd>-<slug>` for both. A name the user edited is
 *    re-validated. Every new ticket gets a branch no branch, remote branch or other ticket uses.
 * 2. Refuses a ticket id that is taken and a worktree folder that holds anything (only a missing or
 *    empty folder is ours to use), before touching git.
 * 3. `git fetch origin <base>`, then `git worktree add <root>/<id> -b <branch> origin/<base>`, or the
 *    local base when origin can't be reached.
 * 4. Writes the ticket record (AL-101) with the worktree path and branch.
 *
 * Any failure after step 3 starts is rolled back: the worktree, its folder, the branch and a worktree
 * root the attempt created are removed, so nothing half-created is left. Launches in one repo run one
 * at a time, so two tickets can never pick the same branch or folder.
 */
export interface TicketWorktreeService {
  create(input: CreateTicketWorktreeInput): Promise<Result<CreatedTicketWorktree>>;
  /**
   * The workspace the New agent ticket modal shows (AL-164): the branch and folder `create` would
   * pick now, and whether an edited branch name would be refused and why. Creates nothing and
   * claims nothing, so `create` re-validates. When git can't list branches, the name is still
   * checked against git's rules and the other tickets' branches.
   */
  preview(input: WorktreePreviewRequest): Promise<Result<WorktreePreview>>;
}

/** What the ticket works on (artboard 2 left column). */
export type TicketSubject =
  | {
      kind: 'work-item';
      ado: TicketAdoRef;
      /** The work item title; the branch slug comes from it. */
      title: string;
    }
  | {
      /** "No ticket": named `nt-<yyyymmdd>-<slug>` from the job description. */
      kind: 'no-ticket';
      description: string;
    };

export interface CreateTicketWorktreeInput {
  /** A registered repo's main checkout (settings `repos[].path`). */
  repo: string;
  subject: TicketSubject;
  /** The branch name as the user edited it in the modal (AL-164); generated from the subject when omitted. */
  branch?: string;
  /** Start from this branch instead of the repo's base branch setting. */
  baseBranch?: string;
  /** Card title. Defaults to the work item title, or the first line of the job description. */
  title?: string;
  /** The rest default to the agent defaults in settings. */
  model?: Model;
  effort?: Effort;
  gates?: StageGates;
  skills?: string[];
  /** Lane the card starts in; Queued unless given. */
  stage?: Lane;
  /** Stops waiting and git calls; whatever was created is rolled back. */
  signal?: AbortSignal;
}

export interface CreatedTicketWorktree {
  /** The new ticket record, with `worktreePath` and `branch`. */
  record: TicketRecord;
  /** The commit the branch started at, and whether origin could be fetched. */
  start: WorktreeStart;
}

/** `details.reason` of an error Result from `create`. */
export type TicketWorktreeFailure =
  /** VALIDATION: the repo is not in settings. */
  | 'repo-not-registered'
  /** VALIDATION: the work item reference is malformed. */
  | 'invalid-work-item'
  /** VALIDATION: the base branch name is not a valid branch name. */
  | 'invalid-base-branch'
  /** VALIDATION: the base branch exists neither locally nor on origin. */
  | 'base-not-found'
  /** VALIDATION: the edited branch name breaks git's or Windows' rules (`details.problem`). */
  | 'invalid-branch'
  /** VALIDATION: the edited branch name is an existing branch, remote branch or another ticket's branch. */
  | 'branch-taken'
  /** VALIDATION: a ticket with this id exists or is being created (one ticket per work item). */
  | 'ticket-exists'
  /** VALIDATION: the repo's worktree root is not an absolute path. */
  | 'invalid-worktree-root'
  /** VALIDATION: something already exists at the worktree path. */
  | 'path-occupied'
  /** VALIDATION: git already lists a worktree at the path (its folder may be gone). */
  | 'worktree-registered'
  /** INTERNAL: a git command failed (`details.gitCode`). */
  | 'git-failed'
  /** VALIDATION or INTERNAL: the ticket record could not be written (the store's code). */
  | 'record-failed'
  /** INTERNAL: the caller's signal fired. */
  | 'aborted'
  /** INTERNAL: anything else (a bug); the message says what. */
  | 'unexpected';

export interface TicketWorktreeServiceOptions {
  git: WorktreeGit;
  settings: Pick<SettingsService, 'get'>;
  tickets: Pick<TicketRecordStore, 'get' | 'list' | 'create'>;
  /** For `nt-<yyyymmdd>` names. */
  now?: () => number;
  /** One line per created worktree and per rollback. */
  log?: { info(message: string): void; warn(message: string): void };
  /** Waits between attempts to remove a worktree during a rollback (tests pass zeros). */
  rollbackRetryDelaysMs?: readonly number[];
}

/** The longest card title taken from a job description. */
const DESCRIPTION_TITLE_MAX = 120;

function refuse(reason: TicketWorktreeFailure, message: string, extra: Record<string, unknown> = {}): Err {
  return err('VALIDATION', message, { reason, ...extra });
}

/** The first line of a job description, for the card of a "No ticket" ticket. */
export function titleFromDescription(description: string): string {
  const line = description
    .split(/\r?\n/)
    .map((text) => text.replace(/\s+/g, ' ').trim())
    .find((text) => text !== '');
  if (line === undefined) return '';
  if (line.length <= DESCRIPTION_TITLE_MAX) return line;
  const cut = line.slice(0, DESCRIPTION_TITLE_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > DESCRIPTION_TITLE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

interface Plan {
  ticketId: string;
  branch: string;
  worktreePath: string;
}

export function createTicketWorktreeService(options: TicketWorktreeServiceOptions): TicketWorktreeService {
  const { git, settings, tickets } = options;
  const now = options.now ?? Date.now;
  const log = options.log ?? { info: () => undefined, warn: (message: string) => console.warn(`[worktrees] ${message}`) };
  /** Launches in one repo run one at a time: naming, fetch, add and record. */
  const inRepo = createKeyedQueue();
  /** Naming and claiming the ticket id run one at a time across all repos, because ids are unique across repos (D271). */
  const naming = createKeyedQueue();
  /** Ticket ids claimed by launches still running, in any repo. A launch keeps its claim until its record exists. */
  const creating = new Set<string>();

  const checkRefFormat =
    (cwd: string): CheckRefFormat =>
    async (name) => {
      const { exitCode } = await git.run(['check-ref-format', '--branch', name], { cwd, allowedExitCodes: [1, 128] });
      return exitCode === 0;
    };

  async function folderNames(root: string): Promise<string[]> {
    try {
      return await readdir(root);
    } catch {
      return [];
    }
  }

  /**
   * Picks the ticket id, branch and folder. Runs in the repo's queue and the global naming queue, so no
   * other launch is naming meanwhile; the caller claims the id before the naming queue moves on.
   */
  async function plan(
    input: CreateTicketWorktreeInput,
    repo: string,
    root: string,
    call: CallOptions,
  ): Promise<Result<Plan>> {
    const all = await tickets.list();
    const takenIds = new Set([...all.map((record) => record.id), ...creating]);
    // Branches other tickets of this repo hold, even ones deleted from git since, so no two tickets share one.
    const ticketBranches = all
      .filter((record) => isSameRepoPath(record.repo, repo))
      .flatMap((record) => [record.branch, ...record.subBranches.map((sub) => sub.branch)]);
    const branches = [...(await listBranchNames(git, repo, call)), ...ticketBranches];

    let ticketId: string;
    let generated: string;
    if (input.subject.kind === 'work-item') {
      const { workItemId } = input.subject.ado;
      ticketId = String(workItemId);
      if (takenIds.has(ticketId)) {
        return refuse('ticket-exists', `Work item #${workItemId} already has an agent ticket.`, { ticketId });
      }
      generated = nameWorkItemTicket(workItemId, input.subject.title, branches).branch;
    } else {
      // The `nt-…` name is also the ticket id and the folder, so it must be free as all three.
      const names = nameNoTicket(new Date(now()), input.subject.description, [...branches, ...takenIds, ...(await folderNames(root))]);
      ticketId = names.worktreeDirName;
      generated = names.branch;
    }

    let branch = generated;
    if (input.branch !== undefined && input.branch !== generated) {
      const check = await validateBranchName(input.branch, { checkRefFormat: checkRefFormat(repo), existingBranches: branches });
      if (!check.ok) {
        return check.problem === 'taken'
          ? refuse('branch-taken', check.message, { branch: input.branch, conflictsWith: check.conflictsWith })
          : refuse('invalid-branch', check.message, { branch: input.branch, problem: check.problem });
      }
      branch = input.branch;
    }
    return ok({ ticketId, branch, worktreePath: join(root, ticketId) });
  }

  async function createInRepo(
    input: CreateTicketWorktreeInput,
    repo: string,
    root: string,
    baseBranch: string,
  ): Promise<Result<CreatedTicketWorktree>> {
    const { signal } = input;
    const call: CallOptions = { signal };
    if (signal?.aborted) return err('INTERNAL', 'Creating the worktree was cancelled.', { reason: 'aborted' });

    const planned = await naming('all', async () => {
      const result = await plan(input, repo, root, call);
      if (result.ok) creating.add(result.data.ticketId);
      return result;
    });
    if (!planned.ok) return planned;
    const { ticketId, branch, worktreePath } = planned.data;

    try {
      const pathBefore = await inspectPath(worktreePath);
      if (pathBefore === 'occupied') {
        return refuse('path-occupied', `${worktreePath} already exists. Agent Lanes only creates a worktree in a new or empty folder.`, {
          ticketId,
          worktreePath,
        });
      }
      if (await findRegisteredWorktree(git, repo, worktreePath, call)) {
        return refuse('worktree-registered', `Git already has a worktree registered at ${worktreePath}.`, { ticketId, worktreePath });
      }

      const fetchError = await fetchBase(git, repo, baseBranch, call);
      if (fetchError !== null) log.warn(`Ticket ${ticketId}: ${fetchError} Starting from the local ${baseBranch}.`);
      const start = await resolveStart(git, repo, baseBranch, fetchError, call);
      if (!start) {
        return refuse('base-not-found', `The base branch "${baseBranch}" was not found locally or on origin.`, {
          baseBranch,
          fetchError,
        });
      }

      const rootBefore = (await inspectPath(root)) !== 'missing';
      const rollBack = async (): Promise<RollbackReport> => {
        const report = await undoWorktreeAdd(git, {
          repo,
          path: worktreePath,
          branch,
          commit: start.commit,
          pathBefore,
          root,
          rootBefore,
          retryDelaysMs: options.rollbackRetryDelaysMs,
        });
        if (report.complete) log.info(`Ticket ${ticketId}: rolled back the worktree and branch ${branch}.`);
        else log.warn(`Ticket ${ticketId}: rollback left ${report.leftovers.join(', ')}.`);
        return report;
      };

      try {
        await addWorktree(git, repo, { path: worktreePath, branch, commit: start.commit }, call);
      } catch (error) {
        const rollback = await rollBack();
        if (isGitError(error, 'ABORTED')) return err('INTERNAL', 'Creating the worktree was cancelled.', { reason: 'aborted', rollback });
        if (!isGitError(error)) throw error;
        return err('INTERNAL', error.message, { reason: 'git-failed', gitCode: error.code, exitCode: error.exitCode, rollback });
      }

      if (signal?.aborted) {
        return err('INTERNAL', 'Creating the worktree was cancelled.', { reason: 'aborted', rollback: await rollBack() });
      }

      const defaults = settings.get().defaults;
      const subject = input.subject;
      const created = await tickets
        .create({
          id: ticketId,
          title: input.title ?? (subject.kind === 'work-item' ? subject.title : titleFromDescription(subject.description)),
          ado: subject.kind === 'work-item' ? subject.ado : null,
          repo,
          baseBranch,
          branch,
          worktreePath,
          model: input.model ?? defaults.model,
          effort: input.effort ?? defaults.effort,
          gates: input.gates ?? defaults.stageGates,
          skills: input.skills ?? defaults.skills,
          stage: input.stage,
        })
        .catch((cause: unknown) => err('INTERNAL', cause instanceof Error ? cause.message : String(cause)));
      if (!created.ok) {
        const rollback = await rollBack();
        return err(created.code, `The ticket record could not be saved: ${created.message}`, {
          reason: 'record-failed',
          cause: created.details,
          rollback,
        });
      }

      log.info(`Ticket ${ticketId}: worktree ${worktreePath} on ${branch} from ${start.ref} (${start.commit.slice(0, 12)}).`);
      return ok({ record: created.data, start });
    } finally {
      creating.delete(ticketId);
    }
  }

  async function preview(input: WorktreePreviewRequest): Promise<Result<WorktreePreview>> {
    const repoSettings = settings.get().repos.find((repo) => isSameRepoPath(repo.path, input.repo));
    if (!repoSettings) return refuse('repo-not-registered', `${input.repo} is not a registered repo.`, { repo: input.repo });
    const repo = repoSettings.path;
    const root = isAbsolute(repoSettings.worktreeRoot) ? normalize(repoSettings.worktreeRoot) : null;

    const all = await tickets.list();
    const ticketBranches = all
      .filter((record) => isSameRepoPath(record.repo, repo))
      .flatMap((record) => [record.branch, ...record.subBranches.map((sub) => sub.branch)]);
    // Without git the preview still names the ticket and applies git's rules; launch asks git again.
    let gitBranches: string[] = [];
    let gitWorks = true;
    try {
      gitBranches = await listBranchNames(git, repo);
    } catch {
      gitWorks = false;
    }
    const branches = [...gitBranches, ...ticketBranches];

    let generatedBranch: string | null = null;
    let ticketId: string | null = null;
    const subject = input.subject;
    if (subject?.kind === 'work-item') {
      ticketId = String(subject.workItemId);
      generatedBranch = nameWorkItemTicket(subject.workItemId, subject.title, branches).branch;
    } else if (subject?.kind === 'no-ticket') {
      const takenIds = all.map((record) => record.id);
      const names = nameNoTicket(new Date(now()), subject.description, [...branches, ...takenIds, ...(root ? await folderNames(root) : [])]);
      ticketId = names.worktreeDirName;
      generatedBranch = names.branch;
    }

    let problem: WorktreePreview['problem'] = null;
    const edited = input.branch;
    if (edited !== null && edited !== generatedBranch) {
      const check = await validateBranchName(edited, {
        checkRefFormat: gitWorks ? checkRefFormat(repo) : async () => true,
        existingBranches: branches,
      }).catch(() => checkBranchName(edited));
      if (!check.ok) problem = { reason: check.problem === 'taken' ? 'branch-taken' : 'invalid-branch', message: check.message };
    }

    return ok({
      repo,
      repoName: repoSettings.name,
      baseBranch: repoSettings.baseBranch,
      generatedBranch,
      branch: edited ?? generatedBranch,
      worktreePath: root && ticketId ? join(root, ticketId) : null,
      problem,
    });
  }

  return {
    preview: (input) =>
      preview(input).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        return err('INTERNAL', `Previewing the worktree failed: ${message}`, { reason: 'unexpected' });
      }),
    async create(input) {
      const repoSettings = settings.get().repos.find((repo) => isSameRepoPath(repo.path, input.repo));
      if (!repoSettings) return refuse('repo-not-registered', `${input.repo} is not a registered repo.`, { repo: input.repo });
      if (input.subject.kind === 'work-item') {
        const ado = TicketAdoRefSchema.safeParse(input.subject.ado);
        if (!ado.success) return refuse('invalid-work-item', 'The work item reference is not valid.', { issues: ado.error.issues });
      }

      const baseBranch = input.baseBranch ?? repoSettings.baseBranch;
      const baseCheck = checkBranchName(baseBranch);
      if (!baseCheck.ok) {
        return refuse('invalid-base-branch', `Base branch "${baseBranch}": ${baseCheck.message}`, { baseBranch, problem: baseCheck.problem });
      }
      if (!isAbsolute(repoSettings.worktreeRoot)) {
        return refuse('invalid-worktree-root', `The worktree folder "${repoSettings.worktreeRoot}" is not an absolute path.`, {
          worktreeRoot: repoSettings.worktreeRoot,
        });
      }

      try {
        await git.ensureSupported({ signal: input.signal });
        return await inRepo(repoPathKey(repoSettings.path), () =>
          createInRepo(input, repoSettings.path, normalize(repoSettings.worktreeRoot), baseBranch),
        );
      } catch (error) {
        if (isGitError(error, 'ABORTED')) return err('INTERNAL', 'Creating the worktree was cancelled.', { reason: 'aborted' });
        if (isGitError(error)) {
          return err('INTERNAL', error.message, { reason: 'git-failed', gitCode: error.code, exitCode: error.exitCode });
        }
        const message = error instanceof Error ? error.message : String(error);
        return err('INTERNAL', `Creating the worktree failed: ${message}`, { reason: 'unexpected' });
      }
    },
  };
}
