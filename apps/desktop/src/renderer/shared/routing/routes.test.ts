import { describe, expect, it } from 'vitest';
import { isSameRoute, parseRoutePath, routeToPath, routes, type Route } from './routes';

describe('routes', () => {
  it.each<[Route, string]>([
    [routes.board(), 'board'],
    [routes.ticket('71273'), 'ticket/71273'],
    [routes.ticketDesign('71273'), 'ticket/71273/design'],
    [routes.gallery(), 'gallery'],
  ])('writes %o as %s and reads it back', (route, path) => {
    expect(routeToPath(route)).toBe(path);
    expect(parseRoutePath(path)).toEqual(route);
  });

  it('reads a location hash, with or without slashes around it', () => {
    expect(parseRoutePath('#/ticket/71273/design')).toEqual(routes.ticketDesign('71273'));
    expect(parseRoutePath('/ticket/nt-3f9a/')).toEqual(routes.ticket('nt-3f9a'));
    expect(parseRoutePath('#board')).toEqual(routes.board());
  });

  it('encodes ticket ids so any id round-trips', () => {
    const route = routes.ticket('nt-a b/c?');
    expect(routeToPath(route)).toBe('ticket/nt-a%20b%2Fc%3F');
    expect(parseRoutePath(routeToPath(route))).toEqual(route);
  });

  it.each(['', '#', '#/', 'boards', 'board/1', 'ticket', 'ticket/', 'ticket/%20', 'ticket/1/diff', 'ticket/1/design/x', 'ticket/%E0%A4%A'])(
    'rejects %j',
    (path) => {
      expect(parseRoutePath(path)).toBeUndefined();
    },
  );

  it('compares routes by value', () => {
    expect(isSameRoute(routes.ticket('1'), routes.ticket('1'))).toBe(true);
    expect(isSameRoute(routes.ticket('1'), routes.ticket('2'))).toBe(false);
    expect(isSameRoute(routes.ticket('1'), routes.ticketDesign('1'))).toBe(false);
  });
});
