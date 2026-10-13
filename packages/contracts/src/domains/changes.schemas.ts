import { z } from 'zod';
import type { InvokeContract } from '../contract';
import { TicketIdSchema } from '../events';
import type { CHANGES_EVENT_CHANNELS, CHANGES_INVOKE_CHANNELS } from './changes.names';

// ── Changed files with authors (AL-276, handoff "Flight deck + Code City") ───────────────────────
//
// `git:diff` (AL-089) lists a ticket's files; `diff:files` adds who wrote each file, whether the change is only in the
// working tree, and where the review stands. Attribution is worked out in the main process from the Edit, MultiEdit and
// Write calls in the ticket's transcripts (the lead's, a sub-agent's, a second agent's); no git blame is needed.

const CountSchema = z.int().nonnegative();

export const CHANGE_KINDS = ['added', 'modified', 'deleted', 'renamed', 'binary'] as const;
export const ChangeKindSchema = z.enum(CHANGE_KINDS);
export type ChangeKind = z.infer<typeof ChangeKindSchema>;

/** One file the ticket changed. Not `DiffFile`: that is `git:diff`'s row. */
export const ChangedFileSchema = z.object({
  /** Worktree-relative, forward slashes. */
  path: z.string().min(1),
  /** The path before a rename; null otherwise. */
  oldPath: z.string().min(1).nullable(),
  kind: ChangeKindSchema,
  /** 0 for a binary file. */
  added: CountSchema,
  removed: CountSchema,
  /** The agent that wrote most of the file's lines (lead = the ticket id, a sub-agent = its tool use id, a second agent = its ticket id); null = you, or a merge. */
  authorAgentId: z.string().min(1).max(200).nullable(),
  /** Every agent that edited it, first editor first. */
  touchedBy: z.array(z.string().min(1).max(200)),
  /** The change exists only in the working tree (not committed yet). */
  uncommitted: z.boolean(),
});
export type ChangedFile = z.infer<typeof ChangedFileSchema>;

export const REVIEW_STATUSES = ['notReviewed', 'inReview', 'passed', 'changesRequested'] as const;
export const ReviewStatusSchema = z.enum(REVIEW_STATUSES);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const DiffFilesRequestSchema = z.strictObject({ ticketId: TicketIdSchema });
export type DiffFilesRequest = z.infer<typeof DiffFilesRequestSchema>;

export const DiffFilesResponseSchema = z.object({
  ticketId: TicketIdSchema,
  /** The base ref compared with and the ticket's head (branch name). */
  base: z.string().min(1),
  head: z.string().min(1),
  files: z.array(ChangedFileSchema).max(2_000),
  /** More files changed than `files` lists. */
  truncated: z.boolean(),
  /** Review status by file path; a path with no entry is `notReviewed`. */
  reviewStatus: z.record(z.string(), ReviewStatusSchema),
});
export type DiffFilesResponse = z.infer<typeof DiffFilesResponseSchema>;

// ── Review findings (AL-277) ─────────────────────────────────────────────────────────────────────
//
// The review agent ends each file with a fenced ```json block
// `{"file": path, "status": "passed" | "changesRequested", "findings": [{"line": n, "severity": "warn", "text": "..."}]}`.

export const FINDING_SEVERITIES = ['info', 'warn', 'error'] as const;
export const FindingSeveritySchema = z.enum(FINDING_SEVERITIES);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const ReviewFindingSchema = z.object({
  /** Stable for the same finding: `<agentId>:<filePath>:<line|0>:<index>`. */
  id: z.string().min(1).max(600),
  filePath: z.string().min(1),
  line: z.int().positive().nullable(),
  severity: FindingSeveritySchema,
  /** One or two sentences. */
  text: z.string().min(1).max(2_000),
  /** The reviewer (same id space as `ChangedFile.authorAgentId`). */
  agentId: z.string().min(1).max(200),
  /** The PR thread the finding was posted to, once /pr-comment-actioner did so. */
  prThreadId: z.int().positive().optional(),
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

export const ReviewFindingsRequestSchema = z.strictObject({ ticketId: TicketIdSchema });
export const ReviewFindingsResponseSchema = z.array(ReviewFindingSchema).max(2_000);
export type ReviewFindingsResponse = z.infer<typeof ReviewFindingsResponseSchema>;

export const changesInvokeContracts = {
  'diff:files': { request: DiffFilesRequestSchema, response: DiffFilesResponseSchema },
  'review:findings': { request: ReviewFindingsRequestSchema, response: ReviewFindingsResponseSchema },
} as const satisfies Record<(typeof CHANGES_INVOKE_CHANNELS)[number], InvokeContract>;

export const changesEventContracts = {} as const satisfies Record<(typeof CHANGES_EVENT_CHANNELS)[number], z.ZodType>;
