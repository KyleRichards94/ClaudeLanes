import { useEffect, useState } from 'react';

/** Anything with Zustand's `getState` / `subscribe`. */
export interface FrameSelectableStore<S> {
  getState(): S;
  subscribe(listener: () => void): () => void;
}

/**
 * Like `useStore(store, selector)`, but re-renders at most once per animation frame however often
 * the store changes (design §12: the live dock "updates no more than once per frame under load").
 * `selector` must be stable (module level or memoised); the value is compared with `Object.is`.
 */
export function useFrameSelector<S, T>(store: FrameSelectableStore<S>, selector: (state: S) => T): T {
  const [value, setValue] = useState(() => selector(store.getState()));

  useEffect(() => {
    let frame: number | null = null;
    const flush = () => {
      frame = null;
      setValue(selector(store.getState()));
    };
    const schedule = () => {
      frame ??= requestAnimationFrame(flush);
    };
    const unsubscribe = store.subscribe(schedule);
    // Catch up with anything that changed between the first render and subscribing.
    schedule();
    return () => {
      unsubscribe();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [store, selector]);

  return value;
}
