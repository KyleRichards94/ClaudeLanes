import { lazy } from 'react';

// One dynamic import per page, and nothing imports a page statically, so Vite emits each page as its
// own chunk (named `page-<slice>-<hash>.js`, see electron.vite.config.ts) and loads it the first time
// its route is shown (design §12).
export const BoardPage = lazy(() => import('@/pages/board').then((page) => ({ default: page.BoardPage })));
export const TicketPage = lazy(() => import('@/pages/ticket').then((page) => ({ default: page.TicketPage })));
export const DesignTabPage = lazy(() =>
  import('@/pages/design-tab').then((page) => ({ default: page.DesignTabPage })),
);

/**
 * The component gallery (AL-032), or null in a production build. `__GALLERY__` is a build-time
 * constant (electron.vite.config.ts): with it false the import below is dead code, so the gallery
 * page never reaches the production bundle.
 */
export const GalleryPage = __GALLERY__
  ? lazy(() => import('@/pages/gallery').then((page) => ({ default: page.GalleryPage })))
  : null;

/** The popped-out Backlog window's page (AL-239): only that window opens it. */
export const BacklogWindowPage = lazy(() =>
  import('@/pages/backlog-window').then((page) => ({ default: page.BacklogWindowPage })),
);
