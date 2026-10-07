import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeBridge, type FakeBridge } from '@/shared/testing';
import { ErrorBoundary } from './ErrorBoundary';
import { ErrorFallback } from './ErrorFallback';

let shouldThrow: boolean;

function Fragile() {
  if (shouldThrow) throw new TypeError("Cannot read properties of undefined (reading 'title')");
  return <Text>Card content</Text>;
}

let bridge: FakeBridge;

beforeEach(() => {
  shouldThrow = true;
  bridge = installFakeBridge({
    'app:logError': { ok: true, data: null },
    'app:copyDiagnostics': { ok: true, data: { characters: 900 } },
  });
  // React reports caught render errors on the console; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('shows what failed instead of the broken part and leaves its siblings alone', () => {
    render(
      <>
        <ErrorBoundary name="lane:Planning" label="the Planning lane">
          <Fragile />
        </ErrorBoundary>
        <Text>Other lane</Text>
      </>,
    );

    expect(screen.getByRole('heading', { name: 'Something went wrong in the Planning lane' })).toBeTruthy();
    expect(screen.getByText("TypeError: Cannot read properties of undefined (reading 'title')")).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Other lane')).toBeTruthy();
  });

  it('logs the error to the main process with the boundary name and component stack', async () => {
    render(
      <ErrorBoundary name="lane:Planning" label="the Planning lane">
        <Fragile />
      </ErrorBoundary>,
    );

    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('app:logError', expect.anything()));
    const report = vi.mocked(bridge.invoke).mock.calls.find(([channel]) => channel === 'app:logError')?.[1];
    expect(report).toMatchObject({
      source: 'boundary',
      boundary: 'lane:Planning',
      name: 'TypeError',
      message: "Cannot read properties of undefined (reading 'title')",
    });
    expect((report as { componentStack?: string }).componentStack).toContain('Fragile');
  });

  it('renders the children again on Retry', () => {
    const onReset = vi.fn();
    render(
      <ErrorBoundary name="app" label="Agent Lanes" onReset={onReset}>
        <Fragile />
      </ErrorBoundary>,
    );

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Card content')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ErrorFallback', () => {
  it('copies diagnostics through the main process and says so', async () => {
    render(<ErrorFallback label="Agent Lanes" error={new Error('boom')} />);

    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

    expect(await screen.findByText('Diagnostics copied to the clipboard, with tokens left out.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(bridge.invoke).toHaveBeenCalledWith('app:copyDiagnostics', undefined);
  });

  it('says why when diagnostics cannot be copied', async () => {
    installFakeBridge({ 'app:copyDiagnostics': { ok: false, code: 'INTERNAL', message: 'clipboard unavailable' } });
    render(<ErrorFallback label="Agent Lanes" error={new Error('boom')} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

    expect(await screen.findByText("Couldn't copy diagnostics: clipboard unavailable")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy diagnostics' })).toBeTruthy();
  });

  it('shows a plain Error by its message alone', () => {
    render(<ErrorFallback label="the board" error={new Error('ADO is unreachable')} variant="page" />);
    expect(screen.getByTestId('error-fallback-error').textContent).toBe('ADO is unreachable');
  });
});
