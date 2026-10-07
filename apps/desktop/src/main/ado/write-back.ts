import {
  addWorkItemComment,
  listWorkItemComments,
  setWorkItemState,
  type AdoClient,
  type WriteBackCallOptions,
} from '@agent-lanes/ado-client';
import { err, ok, type Result, type WorkItemComment, type WorkItemStateWriteBack } from '@agent-lanes/contracts';
import type { SettingsService } from '../settings/service';

/**
 * Work item write-back in the main process (AL-063, design §7 "ADO write-back"). Stage changes
 * (AL-115) and Create PR (AL-181) post their comments through here, so every comment carries the
 * "Agent Lanes · " prefix, and state changes happen only while Settings › ADO state transitions is
 * on. That setting is off by default and read at every call, so turning it off stops the next change.
 */

/** The work item to write to, and the Azure DevOps organisation it lives in. */
export interface WorkItemTarget {
  /** The organisation's connection, as `clientFor` knows it (AL-042: `ado:<org>`). */
  org: string;
  /** Project name or id. */
  project: string;
  workItemId: number;
}

export interface SetStateOptions extends WriteBackCallOptions {
  /** Plain text added to the discussion with the change ("Agent Lanes · <reason>"). */
  reason?: string;
}

export interface WorkItemWriteBack {
  /** Posts "Agent Lanes · <text>" to the work item's discussion. `text` is plain text. */
  comment(target: WorkItemTarget, text: string, options?: WriteBackCallOptions): Promise<Result<WorkItemComment>>;
  /** The work item's discussion, oldest first, with the app's own comments marked `fromAgentLanes`. */
  comments(target: WorkItemTarget, options?: WriteBackCallOptions): Promise<Result<WorkItemComment[]>>;
  /**
   * Moves the work item to `state` when Settings › ADO state transitions is on. When it is off (the
   * default) ADO is not called and the result is `{ outcome: 'disabled' }`; an item already in
   * `state` gives `unchanged`.
   */
  setState(target: WorkItemTarget, state: string, options?: SetStateOptions): Promise<Result<WorkItemStateWriteBack>>;
}

export interface WorkItemWriteBackOptions {
  /** The ADO client for an organisation, built from its saved connection (AdoService, AL-065). */
  clientFor(org: string): Result<AdoClient> | Promise<Result<AdoClient>>;
  settings: Pick<SettingsService, 'get'>;
}

export function createWorkItemWriteBack({ clientFor, settings }: WorkItemWriteBackOptions): WorkItemWriteBack {
  /** Resolves the client and runs `call`, turning anything thrown into INTERNAL. */
  async function withClient<T>(org: string, call: (client: AdoClient) => Promise<Result<T>>): Promise<Result<T>> {
    try {
      const client = await clientFor(org);
      if (!client.ok) return client;
      return await call(client.data);
    } catch (cause) {
      return err('INTERNAL', `Writing back to Azure DevOps failed unexpectedly: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  return {
    comment(target, text, options) {
      return withClient(target.org, (client) => addWorkItemComment(client, target, text, options));
    },

    comments(target, options) {
      return withClient(target.org, (client) => listWorkItemComments(client, target, options));
    },

    async setState(target, state, options) {
      if (!settings.get().adoStateTransitions) return ok({ outcome: 'disabled', workItemId: target.workItemId });
      return withClient(target.org, (client) => setWorkItemState(client, target, state, options));
    },
  };
}
