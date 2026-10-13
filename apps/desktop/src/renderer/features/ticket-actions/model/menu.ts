import type { AgentSessionState, Lane, TicketAdoRef } from '@agent-lanes/contracts';
import { LANE_LABELS } from '@/shared/config';
import type { ActionMenuItem } from '@/shared/ui';

/** The keys of the card's context menu (AL-270); the page acts on them. */
export const TICKET_MENU = {
  openAdo: 'open-ado',
  description: 'view-description',
  adoState: 'change-ado-state',
  moveStage: 'move-stage',
  assign: 'assign-agent',
  resume: 'resume-session',
  openWorktree: 'open-worktree',
  copyBranch: 'copy-branch',
  remove: 'remove-from-board',
} as const;
export type TicketMenuKey = (typeof TICKET_MENU)[keyof typeof TICKET_MENU];

export interface TicketMenuInput {
  ticket: { id: string; ado: TicketAdoRef | null; branch: string; stage: Lane; session: AgentSessionState };
  /** The work item as the board read it; undefined while it loads, null when it could not be read. */
  workItem?: { state: string | null; webUrl: string | null; description: string | null } | null;
  /** The ticket has a saved session, so Resume can bring it back. */
  resumable: boolean;
}

/** The context menu's items for a card (AL-270): work item actions first, then the agent's, the worktree's, and removal. */
export function ticketMenuItems({ ticket, workItem, resumable }: TicketMenuInput): ActionMenuItem[] {
  const items: ActionMenuItem[] = [];
  if (ticket.ado) {
    items.push(
      { key: TICKET_MENU.openAdo, label: 'Open in Azure DevOps', icon: 'arrow-up-right', section: 'Work item', disabled: !workItem?.webUrl },
      { key: TICKET_MENU.description, label: 'View description', icon: 'file', section: 'Work item', disabled: !workItem?.description },
      { key: TICKET_MENU.adoState, label: 'Change ADO state…', ...(workItem?.state ? { detail: `Now ${workItem.state}` } : {}), icon: 'edit', section: 'Work item', disabled: !workItem },
    );
  }
  const ended = ticket.session === 'stopped' || ticket.session === 'lost' || ticket.session === 'none';
  items.push(
    { key: TICKET_MENU.moveStage, label: 'Move to stage…', detail: `Now ${LANE_LABELS[ticket.stage]}`, icon: 'branch', section: 'Agent' },
    { key: TICKET_MENU.assign, label: 'Assign new agent…', detail: 'Ends this agent and starts another here, with a hand-over brief or fresh.', icon: 'add-agent', section: 'Agent' },
    {
      key: TICKET_MENU.resume,
      label: ticket.session === 'lost' ? 'Reconnect session' : 'Resume session',
      detail: ended ? (resumable ? 'Starts the saved session again.' : 'No saved session; message it from the drill-in to start one.') : 'The session is running.',
      icon: 'refresh',
      section: 'Agent',
      disabled: !ended || !resumable,
    },
    { key: TICKET_MENU.openWorktree, label: 'Open worktree folder', icon: 'folder', section: 'Worktree' },
    { key: TICKET_MENU.copyBranch, label: 'Copy branch name', detail: ticket.branch, icon: 'copy', section: 'Worktree' },
    { key: TICKET_MENU.remove, label: 'Remove from board…', detail: 'Ends the agent and removes the worktree; the branch stays.', icon: 'archive', danger: true, section: 'Ticket' },
  );
  return items;
}

/** Azure DevOps descriptions are HTML: the text, one paragraph per block. */
export function descriptionText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The lanes a ticket can be moved to by hand (AL-270, AL-274): every lane but Queued. */
export const MOVE_TARGETS: readonly Exclude<Lane, 'queued'>[] = ['planning', 'implementing', 'code-review', 'qa', 'create-pr', 'done', 'review-only', 'qa-only', 'pr-only', 'comments-only'];
