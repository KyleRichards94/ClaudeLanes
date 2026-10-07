import {
  err,
  ok,
  parseDesignCanvasUrl,
  type DesignCanvasRef,
  type DesignViewBounds,
  type DesignViewState,
  type Result,
  type TicketDesign,
} from '@agent-lanes/contracts';
import type { TicketRecordStore } from '../tickets';
import type { DesignViewService } from './view-service';

/**
 * A ticket's Claude Design canvas (AL-193, D122): linking a pasted canvas link to the ticket record,
 * opening the canvas where the user left it, and remembering that place.
 *
 * The record keeps the canvas (`design.canvas`) and the last canvas page the view showed
 * (`design.lastViewUrl`, from `did-navigate` / `did-navigate-in-page`), so a canvas reopened after a
 * restart, or after the live-view limit closed it, lands on the same artboard. While a view is live
 * it is shown as it is and never reloaded (AL-191, R11).
 */
export interface DesignCanvasLinks {
  link(ticketId: string, url: string): Promise<Result<TicketDesign>>;
  unlink(ticketId: string): Promise<Result<TicketDesign>>;
  open(ticketId: string, bounds?: DesignViewBounds): Promise<Result<DesignViewState>>;
  /** The view service's change report; a signed-in canvas page is saved as the ticket's last URL. */
  noteView(view: DesignViewState, closed: boolean): void;
}

export interface DesignCanvasLinksOptions {
  tickets: Pick<TicketRecordStore, 'get' | 'update'>;
  designView: Pick<DesignViewService, 'open' | 'close' | 'get'>;
  /**
   * The e2e stand-in for claude.ai (`AGENT_LANES_DESIGN_TEST_ORIGIN`, unpackaged builds only, D247).
   * When set, canvas links still name claude.ai, and the view loads the same path on this origin.
   */
  testOrigin?: string;
  warn?: (message: string) => void;
}

const CLAUDE_ORIGIN = 'https://claude.ai';

/** True when `url` is the canvas page itself or a page inside it (an artboard path, query or fragment). */
export function isCanvasPage(canvas: DesignCanvasRef, url: string): boolean {
  if (!url.startsWith(canvas.url)) return false;
  const rest = url.slice(canvas.url.length);
  return rest === '' || rest.startsWith('/') || rest.startsWith('?') || rest.startsWith('#');
}

export function createDesignCanvasLinks(options: DesignCanvasLinksOptions): DesignCanvasLinks {
  const { tickets, designView, testOrigin } = options;
  const warn = options.warn ?? (() => undefined);
  /** The URL each live view was opened with and the canvas it shows, so reopening never reloads it. */
  const opened = new Map<string, { canvasUrl: string; viewUrl: string }>();

  const toViewUrl = (url: string) => (testOrigin && url.startsWith(`${CLAUDE_ORIGIN}/`) ? `${testOrigin}${url.slice(CLAUDE_ORIGIN.length)}` : url);
  const fromViewUrl = (url: string) => (testOrigin && url.startsWith(`${testOrigin}/`) ? `${CLAUDE_ORIGIN}${url.slice(testOrigin.length)}` : url);

  async function setCanvas(ticketId: string, canvas: DesignCanvasRef | null): Promise<Result<TicketDesign>> {
    const record = await tickets.get(ticketId);
    if (!record) return err('VALIDATION', `There is no ticket ${ticketId}`);
    const same = record.design.canvas?.url === canvas?.url;
    if (same) return ok(record.design);

    const updated = await tickets.update(ticketId, (current) => ({
      ...current,
      design: { ...current.design, canvas, lastViewUrl: null },
    }));
    if (!updated.ok) return updated;
    // The old canvas's view goes; the new one opens fresh on the design tab.
    designView.close(ticketId);
    opened.delete(ticketId);
    return ok(updated.data.design);
  }

  return {
    link(ticketId, url) {
      const canvas = parseDesignCanvasUrl(url);
      if (!canvas) {
        return Promise.resolve(err('VALIDATION', "That isn't a Claude Design canvas link. Paste a claude.ai/design/p/… or claude.ai/artifact/… link."));
      }
      return setCanvas(ticketId, canvas);
    },

    unlink(ticketId) {
      return setCanvas(ticketId, null);
    },

    async open(ticketId, bounds) {
      const record = await tickets.get(ticketId);
      if (!record) return err('VALIDATION', `There is no ticket ${ticketId}`);
      const canvas = record.design.canvas;
      if (!canvas) return err('VALIDATION', 'This ticket has no linked canvas');

      const previous = opened.get(ticketId);
      let viewUrl: string;
      if (previous && previous.canvasUrl === canvas.url && designView.get(ticketId)) {
        // Live: show it as it is (same URL, so the view service does not navigate).
        viewUrl = previous.viewUrl;
      } else {
        const last = record.design.lastViewUrl;
        viewUrl = toViewUrl(last && isCanvasPage(canvas, last) ? last : canvas.url);
      }

      const result = designView.open(ticketId, viewUrl, bounds);
      if (result.ok) opened.set(ticketId, { canvasUrl: canvas.url, viewUrl });
      return result;
    },

    noteView(view, closed) {
      if (closed) {
        opened.delete(view.ticketId);
        return;
      }
      if (view.status !== 'signed-in' || !view.url) return;
      const url = fromViewUrl(view.url);
      void (async () => {
        const record = await tickets.get(view.ticketId);
        const canvas = record?.design.canvas;
        if (!record || !canvas || !isCanvasPage(canvas, url) || record.design.lastViewUrl === url || url.length > 4096) return;
        const updated = await tickets.update(view.ticketId, (current) =>
          current.design.canvas?.url === canvas.url ? { ...current, design: { ...current.design, lastViewUrl: url } } : current,
        );
        if (!updated.ok) warn(`Could not remember the canvas page of ticket ${view.ticketId}: ${updated.message}`);
      })();
    },
  };
}
