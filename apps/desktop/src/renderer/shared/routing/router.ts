import { createStore, type StoreApi } from 'zustand/vanilla';
import { isSameRoute, routes, type Route } from './routes';

export interface RouterState {
  /** Visited routes, oldest first. */
  readonly entries: readonly Route[];
  /** Position of the current route in `entries`. */
  readonly index: number;
}

export interface NavigateOptions {
  /** Swap the current entry instead of adding one (no new Back step). */
  replace?: boolean;
}

/**
 * In-memory history of typed routes (Decision D13). Readable like a Zustand store, so
 * `useStore(router, selector)` works; only `navigate`, `back` and `forward` change it.
 */
export interface Router extends Pick<StoreApi<RouterState>, 'getState' | 'getInitialState' | 'subscribe'> {
  navigate(route: Route, options?: NavigateOptions): void;
  back(): void;
  forward(): void;
}

/** Oldest entries drop off past this, so a long session can't grow the history without bound. */
export const MAX_HISTORY_ENTRIES = 100;

const boardRoute = routes.board();

export function createRouter(initial: Route = boardRoute): Router {
  const store = createStore<RouterState>()(() => ({ entries: [initial], index: 0 }));

  const navigate = (route: Route, options?: NavigateOptions) => {
    const { entries, index } = store.getState();
    const current = entries[index];
    if (current && isSameRoute(current, route)) return;

    if (options?.replace) {
      store.setState({ entries: entries.with(index, route) });
      return;
    }
    // A new route drops anything ahead of the current entry, as a browser does.
    const next = [...entries.slice(0, index + 1), route].slice(-MAX_HISTORY_ENTRIES);
    store.setState({ entries: next, index: next.length - 1 });
  };

  const back = () => {
    const { index } = store.getState();
    if (index > 0) store.setState({ index: index - 1 });
  };

  const forward = () => {
    const { entries, index } = store.getState();
    if (index < entries.length - 1) store.setState({ index: index + 1 });
  };

  return {
    getState: store.getState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe,
    navigate,
    back,
    forward,
  };
}

export const selectRoute = (state: RouterState): Route => state.entries[state.index] ?? boardRoute;
export const selectCanGoBack = (state: RouterState): boolean => state.index > 0;
export const selectCanGoForward = (state: RouterState): boolean => state.index < state.entries.length - 1;
