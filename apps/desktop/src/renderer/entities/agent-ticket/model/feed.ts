import { createStore, type StoreApi } from 'zustand/vanilla';
import { formatPullRequestActivity } from '@agent-lanes/contracts';
import { LANE_LABELS } from '@/shared/config';
import { needsYouLabel } from '../ui/card-view';
import type { AgentTicketStore, AgentTicketsState } from './store';
import type { AgentTicket } from './types';

/**
 * The board's live feed (artboard 1 live dock: "14:06 #71273 razor-writer committed 3 files"):
 * what just happened across tickets, newest first. It is worked out from changes to the agent ticket
 * store, so every event the store takes in (activity, gates, needs-you, stage moves, builds, PRs)
 * shows up here without a channel of its own.
 */
export interface TicketFeedEvent {
  /** Unique within the feed, for React keys. */
  readonly key: number;
  readonly ticketId: string;
  /** "#71273", or the `nt-…` id of a "No ticket" ticket. */
  readonly ticketLabel: string;
  readonly at: number;
  readonly text: string;
  /** The ticket now needs the user; the dock shows it amber. */
  readonly needsYou: boolean;
}

export interface TicketFeedState {
  /** Newest first, at most `limit`. */
  readonly events: readonly TicketFeedEvent[];
}

export interface TicketFeed extends Pick<StoreApi<TicketFeedState>, 'getState' | 'subscribe'> {
  /** Stops following the ticket store. */
  dispose(): void;
}

/** The dock shows three; the feed keeps a few more so a burst on one ticket can't hide the others for long. */
export const TICKET_FEED_LIMIT = 3;

type Draft = Omit<TicketFeedEvent, 'key' | 'ticketId' | 'ticketLabel'>;

function ticketLabel(ticket: AgentTicket): string {
  return ticket.ado ? `#${ticket.ado.workItemId}` : ticket.id;
}

/** What changed on one ticket, as feed lines. */
function changesOf(before: AgentTicket, after: AgentTicket): Draft[] {
  const drafts: Draft[] = [];
  if (after.stage !== before.stage) {
    drafts.push({
      at: after.stageEnteredAt,
      text: after.stage === 'done' ? `merged into ${after.baseBranch}` : `moved to ${LANE_LABELS[after.stage]}`,
      needsYou: false,
    });
  }
  if (after.activity && after.activity !== before.activity) {
    drafts.push({ at: after.activity.at, text: after.activity.text, needsYou: false });
  }
  for (const reason of after.needsYou) {
    if (!before.needsYou.includes(reason)) drafts.push({ at: reason.since, text: needsYouLabel(reason), needsYou: true });
  }
  const build = after.build.last;
  if (build && build !== before.build.last) {
    const text =
      build.outcome === 'failed'
        ? `build failed · ${build.errors} ${build.errors === 1 ? 'error' : 'errors'}`
        : build.outcome === 'succeeded'
          ? 'build succeeded'
          : 'build cancelled';
    drafts.push({ at: build.finishedAt, text, needsYou: false });
  }
  const pr = after.pullRequest;
  if (pr && (pr.id !== before.pullRequest?.id || pr.status !== before.pullRequest.status)) {
    drafts.push({ at: after.lastOutputAt ?? after.stageEnteredAt, text: formatPullRequestActivity({ id: pr.id, status: pr.status }), needsYou: false });
  }
  return drafts;
}

/** Follows `store` and keeps its latest events. A change that adds no event commits nothing. */
export function createTicketFeed(store: AgentTicketStore, limit = TICKET_FEED_LIMIT): TicketFeed {
  const feed = createStore<TicketFeedState>()(() => ({ events: [] }));
  let key = 0;

  const unsubscribe = store.subscribe((next: AgentTicketsState, previous: AgentTicketsState) => {
    if (next.byId === previous.byId) return;
    const added: TicketFeedEvent[] = [];
    for (const [id, after] of next.byId) {
      const before = previous.byId.get(id);
      // New tickets come from records (start-up, launch), not live work; they are on the board already.
      if (!before || before === after) continue;
      for (const draft of changesOf(before, after)) {
        key += 1;
        added.push({ ...draft, key, ticketId: id, ticketLabel: ticketLabel(after) });
      }
    }
    if (added.length === 0) return;
    added.sort((a, b) => b.at - a.at || b.key - a.key);
    feed.setState(({ events }) => ({ events: [...added, ...events].slice(0, limit) }));
  });

  return { getState: feed.getState, subscribe: feed.subscribe, dispose: unsubscribe };
}

const feeds = new WeakMap<AgentTicketStore, TicketFeed>();

/** The feed of a ticket store, started the first time it is asked for and kept for the app's life. */
export function ticketFeedOf(store: AgentTicketStore): TicketFeed {
  let feed = feeds.get(store);
  if (!feed) {
    feed = createTicketFeed(store);
    feeds.set(store, feed);
  }
  return feed;
}
