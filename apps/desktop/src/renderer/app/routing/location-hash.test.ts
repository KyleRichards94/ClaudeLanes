import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouter, routes, selectRoute } from '@/shared/routing';
import { routeFromHash, routeHash, syncRouterWithHash } from './location-hash';

function setHash(hash: string) {
  window.history.replaceState(null, '', hash || window.location.pathname);
}

/** Assigning `location.hash` is a real fragment navigation: it adds an entry and fires `hashchange`. */
async function navigateHash(hash: string) {
  const changed = new Promise((resolve) => window.addEventListener('hashchange', resolve, { once: true }));
  window.location.hash = hash;
  await changed;
}

describe('location hash', () => {
  let stop: (() => void) | undefined;

  beforeEach(() => setHash(''));
  afterEach(() => stop?.());

  it('writes and reads route hashes', () => {
    expect(routeHash(routes.ticketDesign('71273'))).toBe('#/ticket/71273/design');
    expect(routeFromHash('#/ticket/71273')).toEqual(routes.ticket('71273'));
    expect(routeFromHash('')).toBeUndefined();
  });

  it('shows the current route in the hash, without adding browser history entries', () => {
    const router = createRouter();
    const historyLength = window.history.length;
    stop = syncRouterWithHash(router, window);
    expect(window.location.hash).toBe('#/board');

    router.navigate(routes.ticket('71273'));
    expect(window.location.hash).toBe('#/ticket/71273');
    router.navigate(routes.ticketDesign('71273'));
    router.back();
    expect(window.location.hash).toBe('#/ticket/71273');
    expect(window.history.length).toBe(historyLength);
  });

  it('follows a hash change made outside the router as a navigation', async () => {
    const router = createRouter();
    stop = syncRouterWithHash(router, window);

    await navigateHash('#/ticket/71273/design');
    expect(selectRoute(router.getState())).toEqual(routes.ticketDesign('71273'));

    router.back();
    expect(selectRoute(router.getState())).toEqual(routes.board());
    expect(window.location.hash).toBe('#/board');
  });

  it('puts the current route back when the hash names no route', async () => {
    const router = createRouter(routes.ticket('1'));
    stop = syncRouterWithHash(router, window);
    const listener = vi.fn();
    router.subscribe(listener);

    await navigateHash('#/nowhere');
    expect(listener).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/ticket/1');
  });

  it('stops syncing when stopped', () => {
    const router = createRouter();
    stop = syncRouterWithHash(router, window);
    stop();
    router.navigate(routes.ticket('1'));
    expect(window.location.hash).toBe('#/board');
  });
});
