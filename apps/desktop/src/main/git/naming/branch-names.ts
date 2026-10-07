import { composeName, slugWords } from './slug';

/**
 * Branch and worktree folder names (design §9, artboard 2 "Worktree 71273-cutover-frmjobcontrol-to").
 * Pure functions: the caller lists the repo's branches and passes them in; nothing here runs git.
 *
 * - Ticket with a work item: branch `<id>-<slug>`, worktree folder `<id>`.
 * - Ticket without one:      branch `nt-<yyyymmdd>-<slug>`, worktree folder the same name.
 * - Writer sub-agent:        branch `sub/<ticket-id>-<slug>`, worktree folder `<ticket-id>--<slug>`
 *   (AL-084), where the ticket id is the ticket's worktree folder name.
 *
 * Slugs are lowercase ASCII words joined by `-`. `<id>-<slug>` (and `<ticket-id>-<slug>` after
 * `sub/`) is at most 32 characters, cut on a word boundary where possible. A name already used by
 * an existing branch gets `-2`, `-3`, … and stays within the limit. The one exception: after a
 * ticket id too long to leave room (a long `nt-…` id), the slug still keeps 8 characters.
 */

export const MAX_BRANCH_NAME_LENGTH = 32;
export const SUB_BRANCH_PREFIX = 'sub/';
export const NO_TICKET_PREFIX = 'nt';

/** A slug never shrinks below this many characters, however long the ticket id in front of it. */
const MIN_SLUG_LENGTH = 8;
const TICKET_FALLBACK_SLUG = 'untitled';
const SUB_AGENT_FALLBACK_SLUG = 'agent';
/** Ticket ids are worktree folder names this module generated: a work item id or an `nt-…` name. */
const TICKET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface BranchAndWorktree {
  /** Branch to create, e.g. `71273-cutover-frmjobcontrol-to`. */
  branch: string;
  /** Folder name under the worktree root, e.g. `71273`. */
  worktreeDirName: string;
}

/** Thrown when no suffix can make a name free, i.e. an existing branch is a parent path of it. */
export class BranchNamingError extends Error {
  override readonly name = 'BranchNamingError';
  readonly code = 'PARENT_BRANCH_EXISTS';
  readonly conflictsWith: string;

  constructor(candidate: string, conflictsWith: string) {
    super(
      `Cannot create "${candidate}": the branch "${conflictsWith}" exists, ` +
        `so git cannot also have branches under "${conflictsWith}/".`,
    );
    this.conflictsWith = conflictsWith;
  }
}

/**
 * Existing branch names, compared case-insensitively: loose refs are files, and Windows file names
 * ignore case, so `Foo` and `foo` cannot both exist there.
 */
class BranchIndex {
  /** Lowercased name → the name as given. */
  private readonly names = new Map<string, string>();
  /** Lowercased parent path (`a` and `a/b` for `a/b/c`) → one branch under it. */
  private readonly parents = new Map<string, string>();

  constructor(existing: Iterable<string>) {
    for (const branch of existing) {
      const key = branch.toLowerCase();
      this.names.set(key, branch);
      for (let slash = key.indexOf('/'); slash !== -1; slash = key.indexOf('/', slash + 1)) {
        this.parents.set(key.slice(0, slash), branch);
      }
    }
  }

  /** The existing branch `candidate` clashes with: same name, a branch under it, or a branch above it. */
  conflict(candidate: string): string | undefined {
    const key = candidate.toLowerCase();
    return this.names.get(key) ?? this.parents.get(key) ?? this.parentConflict(candidate);
  }

  /** An existing branch that is a parent path of `candidate` (`sub` blocks every `sub/…`). */
  parentConflict(candidate: string): string | undefined {
    const key = candidate.toLowerCase();
    for (let slash = key.indexOf('/'); slash !== -1; slash = key.indexOf('/', slash + 1)) {
      const parent = this.names.get(key.slice(0, slash));
      if (parent !== undefined) return parent;
    }
    return undefined;
  }
}

/**
 * The existing branch that `name` clashes with, if any: the same name ignoring case, a branch
 * under it (`name/x`), or a branch it would sit under (git keeps refs as paths, so `a` and `a/b`
 * cannot both exist).
 *
 * `existingBranches` should hold the local branches plus the remote ones without their remote
 * prefix (`origin/foo` → `foo`), so a new branch never clashes when it is pushed.
 */
export function findConflictingBranch(name: string, existingBranches: Iterable<string>): string | undefined {
  return new BranchIndex(existingBranches).conflict(name);
}

/** Adds `-2`, `-3`, … until `compose(suffix)` clashes with no existing branch. */
function pickFreeName(compose: (suffix: string) => string, existingBranches: Iterable<string>): string {
  const index = new BranchIndex(existingBranches);
  const first = compose('');
  const blockedBy = index.parentConflict(first);
  if (blockedBy !== undefined) throw new BranchNamingError(first, blockedBy);

  // Each existing branch blocks at most one candidate (parents were ruled out above), so this ends.
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? first : compose(`-${n}`);
    if (index.conflict(candidate) === undefined) return candidate;
  }
}

/** `[namespace]<prefix>-<slug of text>[-N]`, free among `existingBranches`. */
function freeName(
  prefix: string,
  text: string,
  fallbackSlug: string,
  existingBranches: Iterable<string>,
  namespace = '',
): string {
  const found = slugWords(text);
  const words = found.length > 0 ? found : [fallbackSlug];
  const limits = { maxLength: MAX_BRANCH_NAME_LENGTH, minSlugLength: MIN_SLUG_LENGTH };
  return pickFreeName((suffix) => namespace + composeName(prefix, words, { ...limits, suffix }), existingBranches);
}

function formatLocalDate(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}${month}${day}`;
}

/**
 * Branch and worktree folder for a ticket linked to an Azure DevOps work item:
 * `(71273, 'Cutover frmJobControl to Blazor')` → `71273-cutover-frmjobcontrol-to` in folder `71273`.
 * A title with no usable ASCII words gives `<id>-untitled`.
 */
export function nameWorkItemTicket(
  workItemId: number,
  title: string,
  existingBranches: Iterable<string> = [],
): BranchAndWorktree {
  if (!Number.isSafeInteger(workItemId) || workItemId <= 0) {
    throw new RangeError(`Work item id must be a positive integer, got ${workItemId}`);
  }
  const id = String(workItemId);
  return { branch: freeName(id, title, TICKET_FALLBACK_SLUG, existingBranches), worktreeDirName: id };
}

/**
 * Branch and worktree folder for a ticket with no work item (the modal's "No ticket" tab):
 * `nt-<yyyymmdd>-<slug>` from the job description, dated in local time. The folder is the branch
 * name, and it is the ticket id that sub-branches use.
 */
export function nameNoTicket(
  createdAt: Date,
  description: string,
  existingBranches: Iterable<string> = [],
): BranchAndWorktree {
  const prefix = `${NO_TICKET_PREFIX}-${formatLocalDate(createdAt)}`;
  const branch = freeName(prefix, description, TICKET_FALLBACK_SLUG, existingBranches);
  return { branch, worktreeDirName: branch };
}

/**
 * Branch and worktree folder for a writer sub-agent (AL-084): `sub/<ticket-id>-<slug>` off the
 * ticket branch, in folder `<ticket-id>--<slug>`. `ticketId` is the ticket's `worktreeDirName`
 * (the work item id, or the `nt-…` name); `agentName` is the name the SDK's WorktreeCreate hook
 * passes. Throws `BranchNamingError` when a branch named `sub` exists.
 */
export function nameSubAgent(
  ticketId: string | number,
  agentName: string,
  existingBranches: Iterable<string> = [],
): BranchAndWorktree {
  const id = String(ticketId);
  if (!TICKET_ID.test(id)) {
    throw new RangeError(`Ticket id must be a work item id or an ${NO_TICKET_PREFIX}- name, got "${id}"`);
  }
  const branch = freeName(id, agentName, SUB_AGENT_FALLBACK_SLUG, existingBranches, SUB_BRANCH_PREFIX);
  const slug = branch.slice(SUB_BRANCH_PREFIX.length + id.length + 1);
  return { branch, worktreeDirName: `${id}--${slug}` };
}
