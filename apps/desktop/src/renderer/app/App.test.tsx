import { act, configure, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '@agent-lanes/contracts';
import { installFakeSettings } from '@/shared/testing';
import { App } from './index';

// The pages are lazy chunks; their first import can take over a second while the git suites load the machine.
configure({ asyncUtilTimeout: 5_000 });

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
    installFakeSettings(defaultSettings(), { 'app:getInfo': { ok: false, code: 'INTERNAL', message: 'not needed here' } });
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

    fireEvent.click(screen.getByText('Claude Design ↗'));
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
