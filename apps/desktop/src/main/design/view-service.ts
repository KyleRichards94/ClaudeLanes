import { err, ok, type DesignViewBounds, type DesignViewState, type DesignViewStatus, type Result } from '@agent-lanes/contracts';
import type { Emit } from '../ipc/emit';
import type { DesignNavigationPolicy } from './navigation';

/**
 * Claude Design view service (AL-191, design §4 Design view, R10, R11).
 *
 * One live view per ticket canvas, drawn by main over the renderer's canvas placeholder. Leaving the
 * design tab or page only hides the view; it is never destroyed for that, so the canvas keeps its
 * scroll, selection and chat draft across stage changes and tab switches (R11). At most
 * `maxLiveViews` views stay alive; opening one more closes the least recently used.
 *
 * Electron is reached through `DesignViewPlatform` (`./electron-platform`), so this file is plain
 * logic that main tests drive with a fake.
 */

/** Device-independent pixels in the window's content area, as `WebContentsView.setBounds` takes them. */
export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One native view. */
export interface DesignViewHandle {
  /** The view's `webContents.id`. */
  readonly webContentsId: number;
  load(url: string): void;
  setBounds(rect: ViewRect): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

/** What the platform reports about a view's main frame. */
export interface DesignViewCallbacks {
  /** The main frame committed a page or an in-page navigation (`did-navigate`, `did-navigate-in-page`). */
  onNavigated(url: string): void;
  /** The main frame failed to load (aborted navigations excluded) or its renderer process died. */
  onLoadFailed(): void;
}

/** The app window the views are drawn in. */
export interface DesignHostWindow {
  add(view: DesignViewHandle): void;
  remove(view: DesignViewHandle): void;
  /** The renderer's zoom factor; placeholder bounds arrive in CSS pixels. */
  zoomFactor(): number;
}

export interface DesignViewPlatform {
  createView(callbacks: DesignViewCallbacks): DesignViewHandle;
  /** The main window, or undefined while there is none. */
  window(): DesignHostWindow | undefined;
  /** Writes the design partition's cookies to disk so a sign-in survives a restart (D112). */
  flush(): Promise<void>;
}

export interface DesignViewServiceOptions {
  platform: DesignViewPlatform;
  policy: DesignNavigationPolicy;
  emit: Emit;
  /** Live views kept at once; the least recently opened one beyond this is closed. Default 3. */
  maxLiveViews?: number;
}

export interface DesignViewService {
  /** Creates or shows the ticket's view over the placeholder; other views are hidden. */
  open(ticketId: string, url: string, bounds?: DesignViewBounds): Result<DesignViewState>;
  /** Moves the ticket's view to the placeholder's new bounds. False when it has no live view. */
  setBounds(ticketId: string, bounds: DesignViewBounds): boolean;
  /** Parks the ticket's view behind the renderer, keeping it alive. False when it has no live view. */
  hide(ticketId: string): boolean;
  /** Loads the view's current page again (the design tab's reload button). False when it has no live view. */
  reload(ticketId: string): boolean;
  /** Destroys the ticket's view (ticket removed, canvas unlinked). False when it has no live view. */
  close(ticketId: string): boolean;
  get(ticketId: string): DesignViewState | undefined;
  /** Live views, least recently opened first. */
  list(): DesignViewState[];
  /** Closes every view and flushes the design partition's cookies (on quit). */
  dispose(): Promise<void>;
}

export const DEFAULT_MAX_LIVE_DESIGN_VIEWS = 3;

interface Entry {
  readonly ticketId: string;
  readonly handle: DesignViewHandle;
  /** The URL the view was opened with; re-opening with it again does not navigate. */
  canvasUrl: string;
  url: string | null;
  status: DesignViewStatus;
  visible: boolean;
  host: DesignHostWindow | undefined;
  bounds: DesignViewBounds | undefined;
}

export function createDesignViewService(options: DesignViewServiceOptions): DesignViewService {
  const { platform, policy, emit } = options;
  const maxLiveViews = Math.max(1, options.maxLiveViews ?? DEFAULT_MAX_LIVE_DESIGN_VIEWS);
  // Insertion order is recency: an opened view is moved to the end.
  const entries = new Map<string, Entry>();
  let used = false;

  function state(entry: Entry): DesignViewState {
    return { ticketId: entry.ticketId, status: entry.status, url: entry.url, visible: entry.visible };
  }

  function publish(entry: Entry, closed = false): void {
    emit('design:view', { ...state(entry), closed });
  }

  function applyBounds(entry: Entry): void {
    if (!entry.bounds || !entry.host) return;
    const zoom = entry.host.zoomFactor();
    const { x, y, width, height } = entry.bounds;
    entry.handle.setBounds({
      x: Math.round(x * zoom),
      y: Math.round(y * zoom),
      width: Math.max(0, Math.round(width * zoom)),
      height: Math.max(0, Math.round(height * zoom)),
    });
  }

  function setVisible(entry: Entry, visible: boolean): void {
    if (entry.visible === visible) return;
    entry.visible = visible;
    entry.handle.setVisible(visible);
    publish(entry);
  }

  function createEntry(ticketId: string, url: string): Entry {
    // A closed view's late reports are ignored: the ticket may already have a new view.
    const current = () => entries.get(ticketId) === entry;
    const callbacks: DesignViewCallbacks = {
      onNavigated(navigatedTo) {
        if (!current()) return;
        entry.url = policy.publicUrl(navigatedTo);
        entry.status = policy.isSignInPage(navigatedTo) ? 'signed-out' : policy.isAllowed(navigatedTo) ? 'signed-in' : 'load-failed';
        publish(entry);
      },
      onLoadFailed() {
        if (!current()) return;
        entry.status = 'load-failed';
        publish(entry);
      },
    };
    const entry: Entry = {
      ticketId,
      handle: platform.createView(callbacks),
      canvasUrl: url,
      url: null,
      status: 'loading',
      visible: false,
      host: undefined,
      bounds: undefined,
    };
    used = true;
    // Created hidden: it is shown once it is attached and positioned.
    entry.handle.setVisible(false);
    return entry;
  }

  function destroy(entry: Entry): void {
    entries.delete(entry.ticketId);
    entry.host?.remove(entry.handle);
    entry.handle.destroy();
    entry.visible = false;
    publish(entry, true);
  }

  function evictBeyondLimit(keep: string): void {
    for (const entry of [...entries.values()]) {
      if (entries.size <= maxLiveViews) return;
      if (entry.ticketId !== keep) destroy(entry);
    }
  }

  return {
    open(ticketId, url, bounds) {
      if (!policy.isAllowed(url)) {
        return err('VALIDATION', 'The design view only opens claude.ai pages');
      }
      const host = platform.window();
      if (!host) return err('INTERNAL', 'There is no app window to show the design view in');

      let entry = entries.get(ticketId);
      if (entry) {
        entries.delete(ticketId);
      } else {
        entry = createEntry(ticketId, url);
        entry.handle.load(url);
      }
      entries.set(ticketId, entry);

      // Linked to another canvas since it was opened (AL-193): go there; otherwise keep the page as is.
      if (entry.canvasUrl !== url) {
        entry.canvasUrl = url;
        entry.status = 'loading';
        entry.handle.load(url);
        publish(entry);
      }

      // Only one canvas placeholder is on screen at a time.
      for (const other of entries.values()) {
        if (other !== entry) setVisible(other, false);
      }

      if (entry.host !== host) {
        entry.host?.remove(entry.handle);
        host.add(entry.handle);
        entry.host = host;
      }
      if (bounds) entry.bounds = bounds;
      applyBounds(entry);
      setVisible(entry, true);

      evictBeyondLimit(ticketId);
      return ok(state(entry));
    },

    setBounds(ticketId, bounds) {
      const entry = entries.get(ticketId);
      if (!entry) return false;
      entry.bounds = bounds;
      applyBounds(entry);
      return true;
    },

    hide(ticketId) {
      const entry = entries.get(ticketId);
      if (!entry) return false;
      setVisible(entry, false);
      return true;
    },

    reload(ticketId) {
      const entry = entries.get(ticketId);
      if (!entry) return false;
      entry.status = 'loading';
      // The page it shows now (a sign-in page's URL without its one-time query), else the canvas.
      entry.handle.load(entry.url !== null && policy.isAllowed(entry.url) ? entry.url : entry.canvasUrl);
      publish(entry);
      return true;
    },

    close(ticketId) {
      const entry = entries.get(ticketId);
      if (!entry) return false;
      destroy(entry);
      return true;
    },

    get(ticketId) {
      const entry = entries.get(ticketId);
      return entry ? state(entry) : undefined;
    },

    list() {
      return [...entries.values()].map(state);
    },

    async dispose() {
      for (const entry of [...entries.values()]) destroy(entry);
      if (used) await platform.flush();
    },
  };
}
