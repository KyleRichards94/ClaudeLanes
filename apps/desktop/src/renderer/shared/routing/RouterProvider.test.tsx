import { act, render, screen } from '@testing-library/react';
import { Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { RouterProvider, useNavigation, useRoute } from './RouterProvider';
import { createRouter } from './router';
import { routeToPath, routes } from './routes';

function CurrentRoute() {
  const route = useRoute();
  const { canGoBack, canGoForward } = useNavigation();
  return <Text testID="state">{`${routeToPath(route)} back=${canGoBack} forward=${canGoForward}`}</Text>;
}

describe('RouterProvider', () => {
  it('re-renders readers when the route changes', () => {
    const router = createRouter();
    render(
      <RouterProvider router={router}>
        <CurrentRoute />
      </RouterProvider>,
    );
    expect(screen.getByTestId('state').textContent).toBe('board back=false forward=false');

    act(() => router.navigate(routes.ticket('71273')));
    expect(screen.getByTestId('state').textContent).toBe('ticket/71273 back=true forward=false');

    act(() => router.back());
    expect(screen.getByTestId('state').textContent).toBe('board back=false forward=true');
  });

  it('fails loudly without a provider', () => {
    // React logs the thrown render error; the assertion is enough.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<CurrentRoute />)).toThrow(/needs a <RouterProvider>/);
    consoleError.mockRestore();
  });
});
