import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AgentOutputEvent } from '@agent-lanes/contracts';
import { useAgentOutput } from '@/entities/agent-output';
import { branchesQueryKey } from '@/shared/api';

/** How long a file the agent edited is marked "Changed just now". */
export const RECENT_EDIT_MS = 2 * 60_000;
/** A burst of tool calls refreshes the diff once, this long after the last one settles. */
export const LIVE_DIFF_DEBOUNCE_MS = 400;

export interface LiveDiffSignal {
  /** The seq of the newest finished tool call or turn: the diff is read again when it changes. */
  settledSeq: number;
  /** Files the agent's Edit and Write calls changed, newest last, with when each settled. */
  edits: readonly { path: string; at: number }[];
}

function normalisePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

/**
 * What the output says about the worktree: every finished tool call or turn may have changed files
 * (Bash too), and Edit / Write calls name the file they changed. A failed call changed nothing.
 */
export function liveDiffSignal(events: readonly AgentOutputEvent[]): LiveDiffSignal {
  const editRows = new Map<string, string>();
  const edits: { path: string; at: number }[] = [];
  let settledSeq = 0;
  for (const event of events) {
    const { item } = event;
    if (item.kind === 'tool' && (item.tool === 'edit' || item.tool === 'write') && item.detail) {
      editRows.set(item.rowId, normalisePath(item.detail));
    } else if (item.kind === 'tool-result') {
      settledSeq = event.seq;
      const path = editRows.get(item.rowId);
      if (path && !item.isError) edits.push({ path, at: event.at });
    } else if (item.kind === 'result') {
      settledSeq = event.seq;
    }
  }
  return { settledSeq, edits };
}

/** Each file's newest edit within RECENT_EDIT_MS of `now`. */
export function recentEdits(edits: LiveDiffSignal['edits'], now: number): ReadonlyMap<string, number> {
  const recent = new Map<string, number>();
  for (const edit of edits) if (now - edit.at <= RECENT_EDIT_MS) recent.set(edit.path, edit.at);
  return recent;
}

/**
 * The diff pane follows the agent (live): when a tool call or turn settles, the ticket's diff and its
 * open files are read again (once per burst), and the files it just edited are known.
 */
export function useLiveDiff(ticketId: string): LiveDiffSignal {
  const events = useAgentOutput(ticketId);
  const signal = useMemo(() => liveDiffSignal(events), [events]);
  const queryClient = useQueryClient();
  const first = useRef(true);

  useEffect(() => {
    // The transcript already on screen when the pane opens is not news: only later calls refresh it.
    if (first.current) {
      first.current = false;
      return undefined;
    }
    const timer = setTimeout(() => void queryClient.invalidateQueries({ queryKey: branchesQueryKey(ticketId) }), LIVE_DIFF_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [signal.settledSeq, queryClient, ticketId]);

  return signal;
}
