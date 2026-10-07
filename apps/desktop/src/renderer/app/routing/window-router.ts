import { createRouter, type Router } from '@/shared/routing';
import { installHistoryInput } from './history-input';
import { routeFromHash, syncRouterWithHash } from './location-hash';

/** The app's router, opened at the route in the location hash (so a reload keeps the page) or the board. */
export function createAppRouter(target: Window = window): Router {
  return createRouter(routeFromHash(target.location.hash));
}

/** Connects the router to the window: the location hash, the mouse's side buttons and Alt+← / Alt+→. */
export function connectRouterToWindow(router: Router, target: Window = window): () => void {
  const stopHashSync = syncRouterWithHash(router, target);
  const stopHistoryInput = installHistoryInput(target, router);
  return () => {
    stopHistoryInput();
    stopHashSync();
  };
}
