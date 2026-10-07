import { lazy } from 'react';

// One dynamic import per page, and nothing imports a page statically, so Vite emits each page as its
// own chunk (named `page-<slice>-<hash>.js`, see electron.vite.config.ts) and loads it the first time
// its route is shown (design §12).
export const BoardPage = lazy(() => import('@/pages/board').then((page) => ({ default: page.BoardPage })));
export const TicketPage = lazy(() => import('@/pages/ticket').then((page) => ({ default: page.TicketPage })));
export const DesignTabPage = lazy(() =>
  import('@/pages/design-tab').then((page) => ({ default: page.DesignTabPage })),
);
