import { z } from 'zod';
import type { InvokeContract } from '../contract';
import type { REPOS_EVENT_CHANNELS, REPOS_INVOKE_CHANNELS } from './repos.names';
import { RepoSettingsSchema, ReposSchema } from './settings.schemas';

// ── Repo registry and folder picker (AL-081, design §8, §9) ────────────────────────────────────
//
// Repos live in the settings document (`settings.repos`, AL-041). A repo is only ever added through
// `repos:add`, which opens the native folder dialog in main (design §8: "Repo paths are picked with
// a native folder dialog"); the renderer never sends a path to register.

/**
 * Why a picked folder could not be registered. Main has already told the user in a native message
 * box (with "Choose another folder…"), so callers do not need to show it again.
 * - `not-a-repo`: the folder is not inside a git repository.
 * - `bare-repo`: a bare repository, which has no checked-out files to branch worktrees from.
 * - `git-dir`: a folder inside a repository's `.git` folder.
 * - `bare-main`: a linked worktree whose main repository is bare, so there is no main checkout.
 * - `unreadable`: git could not read the folder (for example "dubious ownership").
 */
export const REPO_FOLDER_PROBLEMS = ['not-a-repo', 'bare-repo', 'git-dir', 'bare-main', 'unreadable'] as const;
export const RepoFolderProblemSchema = z.enum(REPO_FOLDER_PROBLEMS);
export type RepoFolderProblem = z.infer<typeof RepoFolderProblemSchema>;

/**
 * `repos:add` outcome. Failures the caller should report (git missing or too old, settings could not
 * be saved) come back as an error Result instead.
 * - `added`: the picked folder's repo is now registered.
 * - `existing`: that repo was already registered; nothing changed.
 * - `cancelled`: the user closed the folder dialog.
 * - `rejected`: the last folder picked was not a usable git work tree; main showed why and the user
 *   chose Cancel. Nothing was stored.
 */
export const AddRepoResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('added'), repo: RepoSettingsSchema, repos: ReposSchema }),
  z.object({ status: z.literal('existing'), repo: RepoSettingsSchema, repos: ReposSchema }),
  z.object({ status: z.literal('cancelled'), repos: ReposSchema }),
  z.object({
    status: z.literal('rejected'),
    reason: RepoFolderProblemSchema,
    /** The folder the user picked last, as the dialog returned it. */
    folder: z.string().min(1),
    repos: ReposSchema,
  }),
]);
export type AddRepoResponse = z.infer<typeof AddRepoResponseSchema>;

/** `repos:remove`: forgets a registered repo. Nothing on disk is touched. */
export const RemoveRepoRequestSchema = z.strictObject({
  /** The registered repo's path (compared without case on Windows). */
  path: z.string().min(1),
});
export type RemoveRepoRequest = z.infer<typeof RemoveRepoRequestSchema>;

/** `removed` is false when no registered repo has that path. */
export const RemoveRepoResponseSchema = z.object({ removed: z.boolean(), repos: ReposSchema });
export type RemoveRepoResponse = z.infer<typeof RemoveRepoResponseSchema>;

export const reposInvokeContracts = {
  /** Registered repos in the order the Repo dropdown lists them (artboard 1). */
  'repos:list': { request: z.undefined(), response: ReposSchema },
  /** Opens the native folder dialog in main, checks the folder is a git work tree, and registers its repo. */
  'repos:add': { request: z.undefined(), response: AddRepoResponseSchema },
  'repos:remove': { request: RemoveRepoRequestSchema, response: RemoveRepoResponseSchema },
} as const satisfies Record<(typeof REPOS_INVOKE_CHANNELS)[number], InvokeContract>;

export const reposEventContracts = {} as const satisfies Record<(typeof REPOS_EVENT_CHANNELS)[number], z.ZodType>;
