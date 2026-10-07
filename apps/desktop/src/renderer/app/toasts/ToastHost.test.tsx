import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INFO_TOAST_DURATION_MS, clearToasts, getToasts, toast } from '@/shared/model';
import { RouterProvider, createRouter, routes, selectRoute, type Router } from '@/shared/routing';
import { installFakeBridge, type FakeBridge } from '@/shared/testing';
import { startEventHub, stopEventHub } from '../entrypoint/EventHub';
import { MAX_VISIBLE_TOASTS, ToastHost } from './ToastHost';

let router: Router;

beforeEach(() => {
  // Only the clock the host uses; React and user-event keep their real scheduling.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  // Testing Library waits on a `setTimeout(0)` after each user-event call and only advances it
  // itself under Jest's fake timers; this lets it do the same under Vitest's.
  vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
  clearToasts();
  router = createRouter();
});

afterEach(() => {
  stopEventHub();
  act(() => clearToasts());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderHost() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(
    <RouterProvider router={router}>
      <ToastHost />
    </RouterProvider>,
  );
  return { user };
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function raise(...args: Parameters<typeof toast>): string {
  let id = '';
  act(() => {
    id = toast(...args);
  });
  return id;
}

/** Each toast's text (title, body, button labels) in stack order. */
const stack = () =>
  Array.from(screen.getByRole('region', { name: 'Notifications' }).querySelectorAll('[role=alert], [role=status]')).map((el) => el.textContent);

describe('ToastHost', () => {
  describe('error toasts stay until acted on', () => {
    it('keeps an error toast for as long as it takes, then runs Reconnect and closes', async () => {
      const reconnect = vi.fn();
      const { user } = renderHost();
      raise({
        tone: 'error',
        title: 'MCP bridge lost the session',
        body: 'cc-71288 stopped responding. The worktree is intact.',
        actions: [{ label: 'Reconnect', onPress: reconnect }],
      });

      advance(10 * 60_000);
      const alert = screen.getByRole('alert');
      expect(within(alert).getByText('MCP bridge lost the session')).toBeTruthy();

      await user.click(within(alert).getByRole('button', { name: 'Reconnect' }));
      expect(reconnect).toHaveBeenCalledOnce();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(getToasts()).toEqual([]);
    });

    it('closes an error toast on Dismiss without running its action', async () => {
      const reconnect = vi.fn();
      const { user } = renderHost();
      raise({ tone: 'error', title: 'MCP bridge lost the session', actions: [{ label: 'Reconnect', onPress: reconnect }] });

      await user.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(reconnect).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it.each(['success', 'warning'] as const)('keeps a %s toast until it is dismissed', async (tone) => {
      const { user } = renderHost();
      raise({ tone, title: 'Worth reading' });

      advance(10 * 60_000);
      expect(screen.getByRole('status')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('keeps the toast when its action throws, so the user can retry', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { user } = renderHost();
      raise({
        tone: 'error',
        title: 'Merge conflict',
        actions: [
          {
            label: 'Open files',
            onPress: () => {
              throw new Error('no editor');
            },
          },
        ],
      });

      await user.click(screen.getByRole('button', { name: 'Open files' }));
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(error).toHaveBeenCalledWith('The "Open files" action on a toast failed', expect.any(Error));
    });
  });

  describe('info toasts auto-dismiss after 5 s', () => {
    it('closes an info toast 5 s after it shows, with no buttons', () => {
      renderHost();
      raise({ tone: 'info', title: 'Diagnostics copied' });
      expect(INFO_TOAST_DURATION_MS).toBe(5_000);
      expect(screen.queryAllByRole('button')).toHaveLength(0);

      advance(4_999);
      expect(screen.getByRole('status')).toBeTruthy();
      advance(1);
      expect(screen.queryByRole('status')).toBeNull();
      expect(getToasts()).toEqual([]);
    });

    it('gives an info toast with an action a Dismiss button too, and still closes it after 5 s', () => {
      renderHost();
      raise({ tone: 'info', title: 'Plan ready for review', actions: [{ label: 'Open ticket', onPress: vi.fn() }] });
      expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Open ticket', 'Dismiss']);

      advance(INFO_TOAST_DURATION_MS);
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('pauses while the pointer is over the toast and resumes with the time left', async () => {
      const { user } = renderHost();
      raise({ tone: 'info', title: 'Diagnostics copied' });

      advance(3_000);
      await user.hover(screen.getByRole('status'));
      advance(60_000);
      expect(screen.getByRole('status')).toBeTruthy();

      await user.unhover(screen.getByRole('status'));
      advance(1_900);
      expect(screen.getByRole('status')).toBeTruthy();
      advance(100);
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('pauses while focus is inside the toast', async () => {
      const { user } = renderHost();
      raise({ tone: 'info', title: 'Plan ready for review', actions: [{ label: 'Open ticket', onPress: vi.fn() }] });

      advance(1_000);
      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open ticket' }));
      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dismiss' }));
      advance(60_000);
      expect(screen.getByRole('status')).toBeTruthy();

      act(() => (document.activeElement as HTMLElement).blur());
      advance(3_900);
      expect(screen.getByRole('status')).toBeTruthy();
      advance(100);
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('starts the 5 s over when the same toast is raised again', () => {
      renderHost();
      raise({ id: 'copied', tone: 'info', title: 'Diagnostics copied' });
      advance(4_000);
      raise({ id: 'copied', tone: 'info', title: 'Diagnostics copied again' });

      advance(4_000);
      expect(screen.getByRole('status').textContent).toContain('Diagnostics copied again');
      advance(1_000);
      expect(screen.queryByRole('status')).toBeNull();
    });
  });

  describe('stacking', () => {
    it('stacks toasts oldest first in a Notifications region', () => {
      renderHost();
      raise({ tone: 'error', title: 'Build failed' });
      raise({ tone: 'warning', title: 'QA gap' });
      raise({ tone: 'info', title: 'Saved' });

      expect(stack()).toEqual(['Build failedDismiss', 'QA gapDismiss', 'Saved']);
    });

    it(`shows ${MAX_VISIBLE_TOASTS} at a time and brings the next in as one closes`, async () => {
      const { user } = renderHost();
      for (const n of [1, 2, 3, 4, 5, 6]) raise({ tone: 'error', title: `Problem ${n}` });

      expect(screen.getAllByRole('alert').map((alert) => within(alert).getByText(/^Problem/).textContent)).toEqual([
        'Problem 1',
        'Problem 2',
        'Problem 3',
        'Problem 4',
      ]);
      expect(screen.getByTestId('toast-host-waiting').textContent).toBe('2 more notices');

      await user.click(within(screen.getAllByRole('alert')[0] as HTMLElement).getByRole('button', { name: 'Dismiss' }));
      expect(screen.getAllByRole('alert').map((alert) => within(alert).getByText(/^Problem/).textContent)).toEqual([
        'Problem 2',
        'Problem 3',
        'Problem 4',
        'Problem 5',
      ]);
      expect(screen.getByTestId('toast-host-waiting').textContent).toBe('1 more notice');
    });

    it('starts a waiting info toast’s 5 s only once it is on screen', async () => {
      const { user } = renderHost();
      for (const n of [1, 2, 3, 4]) raise({ tone: 'error', title: `Problem ${n}` });
      raise({ tone: 'info', title: 'Saved' });

      advance(60_000);
      expect(getToasts().map((entry) => entry.title)).toContain('Saved');

      await user.click(within(screen.getAllByRole('alert')[0] as HTMLElement).getByRole('button', { name: 'Dismiss' }));
      expect(screen.getByRole('status').textContent).toContain('Saved');
      advance(INFO_TOAST_DURATION_MS);
      expect(screen.queryByRole('status')).toBeNull();
    });
  });

  describe('toasts from the main process', () => {
    let bridge: FakeBridge;

    beforeEach(() => {
      bridge = installFakeBridge();
      startEventHub();
    });

    it('shows a toast event and carries out its action intent', async () => {
      const { user } = renderHost();
      act(() => {
        bridge.emit('toast', {
          at: 1,
          id: 'build-failed:71273',
          tone: 'error',
          title: 'Build failed',
          body: '3 errors in JobControl.razor',
          actions: [{ label: 'Open ticket', intent: { type: 'navigate', route: { name: 'ticket', ticketId: '71273' } } }],
        });
      });

      const alert = screen.getByRole('alert');
      expect(within(alert).getByText('3 errors in JobControl.razor')).toBeTruthy();
      advance(60_000);

      await user.click(within(alert).getByRole('button', { name: 'Open ticket' }));
      expect(selectRoute(router.getState())).toEqual(routes.ticket('71273'));
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('auto-dismisses an info toast event after 5 s', () => {
      renderHost();
      act(() => bridge.emit('toast', { at: 1, tone: 'info', title: 'Saved' }));
      expect(screen.getByRole('status').textContent).toContain('Saved');

      advance(INFO_TOAST_DURATION_MS);
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('shows a repeated event with the same id once', () => {
      renderHost();
      const lost = { at: 1, id: 'session-lost:71288', tone: 'error', title: 'MCP bridge lost the session' };
      act(() => {
        bridge.emit('toast', lost);
        bridge.emit('toast', { ...lost, at: 2 });
      });
      expect(screen.getAllByRole('alert')).toHaveLength(1);
    });

    it('drops an invalid event without showing anything', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      renderHost();
      act(() => bridge.emit('toast', { at: 1, tone: 'error', title: 'x', actions: [{ label: 'Run', intent: { type: 'invoke' } }] }));
      expect(getToasts()).toEqual([]);
    });
  });
});
