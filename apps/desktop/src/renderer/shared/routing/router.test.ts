import { describe, expect, it, vi } from 'vitest';
import { MAX_HISTORY_ENTRIES, createRouter, selectCanGoBack, selectCanGoForward, selectRoute, type Router } from './router';
import { routes } from './routes';

const current = (router: Router) => selectRoute(router.getState());

describe('createRouter', () => {
  it('opens at the board unless told otherwise', () => {
    expect(current(createRouter())).toEqual(routes.board());
    expect(current(createRouter(routes.ticket('71273')))).toEqual(routes.ticket('71273'));
  });

  it('goes back and forward through the routes visited', () => {
    const router = createRouter();
    router.navigate(routes.ticket('1'));
    router.navigate(routes.ticketDesign('1'));

    router.back();
    expect(current(router)).toEqual(routes.ticket('1'));
    router.back();
    expect(current(router)).toEqual(routes.board());
    router.forward();
    router.forward();
    expect(current(router)).toEqual(routes.ticketDesign('1'));
  });

  it('stops at either end of the history', () => {
    const router = createRouter();
    router.navigate(routes.ticket('1'));
    const listener = vi.fn();
    router.subscribe(listener);

    router.forward();
    expect(listener).not.toHaveBeenCalled();
    router.back();
    router.back();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(current(router)).toEqual(routes.board());
  });

  it('drops the forward entries when navigating from the middle of the history', () => {
    const router = createRouter();
    router.navigate(routes.ticket('1'));
    router.navigate(routes.ticket('2'));
    router.back();
    router.navigate(routes.ticketDesign('1'));

    expect(router.getState().entries).toEqual([routes.board(), routes.ticket('1'), routes.ticketDesign('1')]);
    expect(selectCanGoForward(router.getState())).toBe(false);
  });

  it('ignores navigation to the route already shown', () => {
    const router = createRouter();
    router.navigate(routes.ticket('1'));
    const listener = vi.fn();
    router.subscribe(listener);

    router.navigate(routes.ticket('1'));
    expect(listener).not.toHaveBeenCalled();
    expect(router.getState().entries).toHaveLength(2);
  });

  it('replaces the current entry without adding a Back step', () => {
    const router = createRouter();
    router.navigate(routes.ticket('1'));
    router.navigate(routes.ticket('2'), { replace: true });

    expect(router.getState()).toEqual({ entries: [routes.board(), routes.ticket('2')], index: 1 });
  });

  it('reports whether Back and Forward have somewhere to go', () => {
    const router = createRouter();
    expect([selectCanGoBack(router.getState()), selectCanGoForward(router.getState())]).toEqual([false, false]);
    router.navigate(routes.ticket('1'));
    expect([selectCanGoBack(router.getState()), selectCanGoForward(router.getState())]).toEqual([true, false]);
    router.back();
    expect([selectCanGoBack(router.getState()), selectCanGoForward(router.getState())]).toEqual([false, true]);
  });

  it(`keeps at most ${MAX_HISTORY_ENTRIES} entries`, () => {
    const router = createRouter();
    for (let id = 1; id <= MAX_HISTORY_ENTRIES + 20; id += 1) router.navigate(routes.ticket(String(id)));

    const { entries, index } = router.getState();
    expect(entries).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(index).toBe(MAX_HISTORY_ENTRIES - 1);
    expect(entries[0]).toEqual(routes.ticket('21'));
    expect(current(router)).toEqual(routes.ticket(String(MAX_HISTORY_ENTRIES + 20)));
  });

  it('keeps working when its actions are passed around unbound', () => {
    const { navigate, back, getState } = createRouter();
    navigate(routes.ticket('1'));
    back();
    expect(selectRoute(getState())).toEqual(routes.board());
  });
});
