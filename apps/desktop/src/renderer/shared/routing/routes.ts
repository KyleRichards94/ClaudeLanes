/**
 * The app's three routes (Decision D13): `board`, `ticket/:id` and `ticket/:id/design`, plus the
 * development-only component gallery (`gallery`, AL-032), which the app layer opens only in
 * `pnpm dev`. A route is a typed value; the path form exists for the location hash and for tests.
 */
export type Route =
  | { readonly name: 'board' }
  | { readonly name: 'ticket'; readonly ticketId: string }
  | { readonly name: 'ticketDesign'; readonly ticketId: string }
  | { readonly name: 'gallery' }
  /** The popped-out Backlog window (AL-239): `backlog`, or `backlog/<team id>` for another team. */
  | { readonly name: 'backlogWindow'; readonly teamId: string | null };

export type RouteName = Route['name'];

/** Route builders, so callers never spell a route by hand. */
export const routes = {
  board: (): Route => ({ name: 'board' }),
  ticket: (ticketId: string): Route => ({ name: 'ticket', ticketId }),
  ticketDesign: (ticketId: string): Route => ({ name: 'ticketDesign', ticketId }),
  gallery: (): Route => ({ name: 'gallery' }),
  backlogWindow: (teamId: string | null = null): Route => ({ name: 'backlogWindow', teamId }),
} as const;

/** `board` · `ticket/71273` · `ticket/71273/design` · `gallery` (the id is URI-encoded). */
export function routeToPath(route: Route): string {
  switch (route.name) {
    case 'board':
      return 'board';
    case 'ticket':
      return `ticket/${encodeURIComponent(route.ticketId)}`;
    case 'ticketDesign':
      return `ticket/${encodeURIComponent(route.ticketId)}/design`;
    case 'gallery':
      return 'gallery';
    case 'backlogWindow':
      return route.teamId === null ? 'backlog' : `backlog/${encodeURIComponent(route.teamId)}`;
  }
}

/**
 * Reads a path back into a route. Accepts a leading `#` and `/` and a trailing `/`, so a
 * location hash (`#/ticket/71273`) parses as-is. Anything else returns `undefined`.
 */
export function parseRoutePath(path: string): Route | undefined {
  const segments = path.replace(/^#/, '').replace(/^\/+|\/+$/g, '').split('/');

  if (segments.length === 1 && segments[0] === 'board') return routes.board();
  if (segments.length === 1 && segments[0] === 'gallery') return routes.gallery();
  if (segments[0] === 'backlog' && segments.length <= 2) {
    if (segments.length === 1) return routes.backlogWindow();
    const teamId = decodeSegment(segments[1] ?? '');
    return teamId ? routes.backlogWindow(teamId) : undefined;
  }
  if (segments[0] !== 'ticket' || segments.length < 2 || segments.length > 3) return undefined;

  const ticketId = decodeSegment(segments[1] ?? '');
  if (!ticketId) return undefined;
  if (segments.length === 2) return routes.ticket(ticketId);
  return segments[2] === 'design' ? routes.ticketDesign(ticketId) : undefined;
}

export function isSameRoute(a: Route, b: Route): boolean {
  return routeToPath(a) === routeToPath(b);
}

function decodeSegment(segment: string): string | undefined {
  try {
    const decoded = decodeURIComponent(segment);
    return decoded.trim() ? decoded : undefined;
  } catch {
    return undefined;
  }
}
