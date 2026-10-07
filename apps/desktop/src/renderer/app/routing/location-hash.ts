import { parseRoutePath, routeToPath, selectRoute, type Route, type Router } from '@/shared/routing';

/** `#/board` · `#/ticket/71273` · `#/ticket/71273/design`. */
export function routeHash(route: Route): string {
  return `#/${routeToPath(route)}`;
}

/** The route in the window's location hash, if it names one. */
export function routeFromHash(hash: string): Route | undefined {
  return parseRoutePath(hash);
}

/**
 * Keeps the location hash showing the current route, so a reload (dev, Ctrl+R) reopens the same
 * page, and follows hash changes made from outside the router (an `href="#/ticket/1"` link,
 * devtools, a test). The hash is written with `replaceState`, so the in-memory router stays the
 * only Back/Forward history. Returns a function that stops syncing.
 */
export function syncRouterWithHash(router: Router, target: Window): () => void {
  const write = () => {
    const hash = routeHash(selectRoute(router.getState()));
    if (target.location.hash !== hash) target.history.replaceState(target.history.state, '', hash);
  };

  const onHashChange = () => {
    const route = routeFromHash(target.location.hash);
    if (route) router.navigate(route);
    // Puts back the current route's hash when the new one named no route.
    write();
  };

  write();
  const unsubscribe = router.subscribe(write);
  target.addEventListener('hashchange', onHashChange);
  return () => {
    unsubscribe();
    target.removeEventListener('hashchange', onHashChange);
  };
}
