import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { selectCanGoBack, selectCanGoForward, selectRoute, type Router } from './router';
import type { Route } from './routes';

// The context carries the router instance, never route state: components subscribe to the
// store with selectors, so only the ones reading the route re-render when it changes.
const RouterContext = createContext<Router | null>(null);

export function RouterProvider({ router, children }: { router: Router; children: ReactNode }) {
  return <RouterContext value={router}>{children}</RouterContext>;
}

export function useRouter(): Router {
  const router = useContext(RouterContext);
  if (!router) throw new Error('useRouter() needs a <RouterProvider> above it (see app/entrypoint/AppProviders).');
  return router;
}

/** The current route. */
export function useRoute(): Route {
  return useStore(useRouter(), selectRoute);
}

/** Navigation actions plus whether Back and Forward have somewhere to go. */
export function useNavigation() {
  const router = useRouter();
  const canGoBack = useStore(router, selectCanGoBack);
  const canGoForward = useStore(router, selectCanGoForward);
  return { navigate: router.navigate, back: router.back, forward: router.forward, canGoBack, canGoForward };
}
