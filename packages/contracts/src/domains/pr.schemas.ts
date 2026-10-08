import { z } from 'zod';
import type { InvokeContract } from '../contract';
import { TicketEventEnvelopeSchema, TicketIdSchema } from '../events';
import {
  PULL_REQUEST_DESCRIPTION_MAX,
  PULL_REQUEST_TITLE_MAX,
  PullRequestIdSchema,
  PullRequestRefSchema,
  PullRequestSnapshotSchema,
  PullRequestStatusSchema,
} from './ado.pull-requests';
import type { PR_EVENT_CHANNELS, PR_INVOKE_CHANNELS } from './pr.names';

// ── Create PR stage (AL-181, design §7 ADO write-back, §9 alternative to step 5, artboard 6 "PR open") ──

/**
 * The pull request a ticket opened, as its record keeps it: enough to read it again after a restart
 * and to show "PR !10612" on the card before ADO answers.
 */
export const TicketPullRequestSchema = z.object({
  ref: PullRequestRefSchema,
  /** The ADO connection it was created through (`ado:contoso`); null for the first connected organisation. */
  org: z.string().min(1).max(200).nullable(),
  id: PullRequestIdSchema,
  /** Only http(s), so it is safe to open externally. */
  webUrl: z.url({ protocol: /^https?$/ }),
  status: PullRequestStatusSchema,
  openedAt: z.int().nonnegative(),
  /** When the app saw it completed or abandoned; null while active. */
  closedAt: z.int().nonnegative().nullable(),
});
export type TicketPullRequest = z.infer<typeof TicketPullRequestSchema>;

export const PrTicketRequestSchema = z.strictObject({ ticketId: TicketIdSchema });
export type PrTicketRequest = z.infer<typeof PrTicketRequestSchema>;

/**
 * `pr:draft`: what the Create PR form starts with. Title and description come from the ticket and the
 * agent's summary; `blocked` says why a PR can't be created yet (no work item, a remote that is not
 * Azure Repos, a ticket not in Create PR), null when it can.
 */
export const PullRequestDraftSchema = z.object({
  title: z.string().max(PULL_REQUEST_TITLE_MAX),
  description: z.string().max(PULL_REQUEST_DESCRIPTION_MAX),
  sourceBranch: z.string().min(1),
  targetBranch: z.string().min(1),
  /** The work item the PR is linked to; null for a "No ticket" ticket. */
  workItemId: z.int().min(1).nullable(),
  /** "OnSite Companion / OnSite"; null when the remote is not an Azure Repos one. */
  repository: z.string().nullable(),
  blocked: z.string().nullable(),
});
export type PullRequestDraft = z.infer<typeof PullRequestDraftSchema>;

/** `pr:create`: the user's edited title and description. */
export const CreateTicketPullRequestRequestSchema = z.strictObject({
  ticketId: TicketIdSchema,
  title: z.string().trim().min(1, 'A pull request needs a title.').max(PULL_REQUEST_TITLE_MAX),
  description: z.string().max(PULL_REQUEST_DESCRIPTION_MAX),
  isDraft: z.boolean().optional(),
});
export type CreateTicketPullRequestRequest = z.infer<typeof CreateTicketPullRequestRequestSchema>;

/** The ticket's PR with its checks as ADO reported them now. */
export const TicketPullRequestStateSchema = z.object({
  pullRequest: TicketPullRequestSchema,
  snapshot: PullRequestSnapshotSchema,
});
export type TicketPullRequestState = z.infer<typeof TicketPullRequestStateSchema>;

/** `pr:create`: `created` is false when an active PR for the same branches already existed and was reused. */
export const CreateTicketPullRequestResponseSchema = TicketPullRequestStateSchema.extend({ created: z.boolean() });
export type CreateTicketPullRequestResponse = z.infer<typeof CreateTicketPullRequestResponseSchema>;

/** `pr:get`: null when the ticket has no PR. */
export const GetTicketPullRequestResponseSchema = z.object({ state: TicketPullRequestStateSchema.nullable() });
export type GetTicketPullRequestResponse = z.infer<typeof GetTicketPullRequestResponseSchema>;

export const prInvokeContracts = {
  'pr:draft': { request: PrTicketRequestSchema, response: PullRequestDraftSchema },
  'pr:create': { request: CreateTicketPullRequestRequestSchema, response: CreateTicketPullRequestResponseSchema },
  'pr:get': { request: PrTicketRequestSchema, response: GetTicketPullRequestResponseSchema },
} as const satisfies Record<(typeof PR_INVOKE_CHANNELS)[number], InvokeContract>;

/** `pr:status`: the card's PR line and the drill-in's checks. */
export const PrStatusEventSchema = TicketEventEnvelopeSchema.extend({
  pullRequestId: PullRequestIdSchema,
  status: PullRequestStatusSchema,
  checks: z.object({ passed: z.int().min(0), total: z.int().min(0), pending: z.int().min(0) }).nullable(),
  webUrl: z.url({ protocol: /^https?$/ }),
});
export type PrStatusEvent = z.infer<typeof PrStatusEventSchema>;

export const prEventContracts = {
  'pr:status': PrStatusEventSchema,
} as const satisfies Record<(typeof PR_EVENT_CHANNELS)[number], z.ZodType>;
