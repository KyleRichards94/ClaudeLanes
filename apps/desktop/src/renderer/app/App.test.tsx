import { act, configure, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '@agent-lanes/contracts';
import { fakeTicketRecord, installFakeSettings } from '@/shared/testing';
import { App } from './index';

// Lazy pages load cold under the full parallel suite; give them as long as AppRouter.test does.
vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 15_000 });

function setHash(hash: string) {
  window.history.replaceState(null, '', hash || window.location.pathname);
}

async function navigateHash(hash: string) {
  await act(async () => {
    const changed = new Promise((resolve) => window.addEventListener('hashchange', resolve, { once: true }));
    window.location.hash = hash;
    await changed;
  });
}

describe('App routing', () => {
  beforeEach(() => {
    setHash('');
    // Saved UI prefs load before the app renders (AL-041); the runtime line isn't needed here.
    installFakeSettings(defaultSettings(), {
      'app:getInfo': { ok: false, code: 'INTERNAL', message: 'not needed here' },
      'tickets:get': { ok: true, data: { record: fakeTicketRecord() } },
    });
  });

  it('opens at the board and shows it in the location hash', async () => {
    render(<App />);
    expect(await screen.findByText('Agent board')).toBeTruthy();
    expect(window.location.hash).toBe('#/board');
  });

  it('reopens the route in the location hash, so a reload keeps the page', async () => {
    setHash('#/ticket/71273/design');
    render(<App />);
    expect(await screen.findByTestId('design-tab-page')).toBeTruthy();
  });

  it('moves between pages and back and forward with Alt+arrows and the mouse side buttons', async () => {
    render(<App />);
    await screen.findByText('Agent board');

    await navigateHash('#/ticket/71273');
    expect(await screen.findByTestId('ticket-page')).toBeTruthy();

    fireEvent.click(await screen.findByRole('tab', { name: 'Claude Design' }));
    expect(await screen.findByTestId('design-tab-page')).toBeTruthy();
    expect(window.location.hash).toBe('#/ticket/71273/design');

    fireEvent.keyDown(document.body, { key: 'ArrowLeft', altKey: true });
    expect(await screen.findByTestId('ticket-page')).toBeTruthy();

    fireEvent.mouseUp(document.body, { button: 3 });
    expect(await screen.findByText('Agent board')).toBeTruthy();
    expect(window.location.hash).toBe('#/board');

    fireEvent.mouseUp(document.body, { button: 4 });
    expect(await screen.findByTestId('ticket-page')).toBeTruthy();

    fireEvent.keyDown(document.body, { key: 'ArrowRight', altKey: true });
    expect(await screen.findByTestId('design-tab-page')).toBeTruthy();

    fireEvent.click(screen.getByText('← Board'));
    expect(await screen.findByText('Agent board')).toBeTruthy();
  });
});
