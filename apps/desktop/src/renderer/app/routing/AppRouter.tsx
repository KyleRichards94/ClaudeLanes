import { Suspense, useDeferredValue } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRoute, type Route } from '@/shared/routing';
import { BoardPage, DesignTabPage, TicketPage } from './pages';

/**
 * Shows the page for the current route, each loaded lazily behind Suspense (design §12).
 *
 * The route is deferred: moving to a page whose chunk hasn't loaded yet keeps the current page on
 * screen until it has, instead of blanking to the fallback. The fallback only shows at start-up.
 */
export function AppRouter() {
  const route = useDeferredValue(useRoute());

  return (
    <Suspense fallback={<PageFallback />}>
      <RoutePage route={route} />
    </Suspense>
  );
}

function RoutePage({ route }: { route: Route }) {
  switch (route.name) {
    case 'board':
      return <BoardPage />;
    case 'ticket':
      return <TicketPage ticketId={route.ticketId} />;
    case 'ticketDesign':
      return <DesignTabPage ticketId={route.ticketId} />;
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
