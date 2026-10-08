import { Suspense, useDeferredValue, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { routeToPath, useRoute, type Route } from '@/shared/routing';
import { PageErrorBoundary } from '@/shared/ui';
import { BacklogWindowPage, BoardPage, DesignTabPage, GalleryPage, TicketPage } from './pages';

/**
 * Shows the page for the current route, each loaded lazily behind Suspense (design §12).
 *
 * The route is deferred: moving to a page whose chunk hasn't loaded yet keeps the current page on
 * screen until it has, instead of blanking to the fallback. The fallback only shows at start-up.
 *
 * Each page has its own error boundary (design §12, AL-210), keyed by the route's path so moving to
 * another page or ticket starts with a fresh boundary instead of the last page's fallback.
 */
export function AppRouter() {
  const route = useDeferredValue(useRoute());

  return (
    <Suspense fallback={<PageFallback />}>
      <PageErrorBoundary key={routeToPath(route)} page={route.name} label={pageLabel(route)}>
        <RoutePage route={route} />
      </PageErrorBoundary>
    </Suspense>
  );
}

/** Every route name needs a case here; a missing one fails the build (no implicit return). */
function RoutePage({ route }: { route: Route }): ReactElement {
  switch (route.name) {
    case 'board':
      return <BoardPage />;
    case 'ticket':
      return <TicketPage ticketId={route.ticketId} />;
    case 'ticketDesign':
      return <DesignTabPage ticketId={route.ticketId} />;
    case 'gallery':
      // Development only (AL-032); a production build has no gallery and shows the board.
      return GalleryPage ? <GalleryPage /> : <BoardPage />;
    case 'backlogWindow':
      return <BacklogWindowPage teamId={route.teamId} />;
  }
}

/** What a page's error fallback says failed. */
function pageLabel(route: Route): string {
  switch (route.name) {
    case 'board':
      return 'the board';
    case 'ticket':
      return `ticket #${route.ticketId}`;
    case 'ticketDesign':
      return `the Claude Design tab of #${route.ticketId}`;
    case 'gallery':
      return 'the component gallery';
    case 'backlogWindow':
      return 'the backlog';
  }
}

/** Blank on purpose: a page chunk loads from disk in milliseconds, so a spinner would only flicker. */
function PageFallback() {
  return <View style={styles.fallback} aria-busy aria-label="Loading" testID="page-loading" />;
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
  },
});
