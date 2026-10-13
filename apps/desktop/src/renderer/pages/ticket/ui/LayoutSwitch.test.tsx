import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeTicketRecord, installFakeSettings } from '@/shared/testing';
import { useUiPrefs } from '@/shared/model';
import { agentTickets } from '@/entities/agent-ticket';
import { INCOMING_DELAY_MS, LayoutSwitch, SLIDE_PX, TRANSITION_MS } from './LayoutSwitch.web';

vi.mock('./CodeCityPanel', () => ({ default: () => <div data-testid="code-city-stub">city</div> }));

const record = fakeTicketRecord();
const codeCity = {
  ticket: agentTickets.getState().byId.get('71273') as never,
  companions: [],
  history: record.stageHistory,
  composer: null,
  worktree: null,
};

function setLayout(layout: 'flightDeck' | 'codeCity') {
  act(() => {
    useUiPrefs.getState().setTicketLayout(layout);
  });
}

function mockReducedMotion(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

const pane = (name: 'flightDeck' | 'codeCity') => screen.getByTestId(`layout-pane-${name}`);

describe('LayoutSwitch (AL-275)', () => {
  beforeEach(() => {
    installFakeSettings();
    useUiPrefs.setState({ ticketLayout: undefined });
    mockReducedMotion(false);
  });
  afterEach(() => {
    // @ts-expect-error back to jsdom's none
    delete window.matchMedia;
  });

  it('opens on Flight deck and loads nothing of Code City until it is chosen', () => {
    render(<LayoutSwitch flightDeck={<p>deck body</p>} codeCity={codeCity} />);
    expect(screen.getByText('deck body')).toBeTruthy();
    expect(pane('flightDeck').style.display).toBe('flex');
    expect(screen.queryByTestId('layout-pane-codeCity')).toBeNull();
    expect(screen.getByTestId('layout-switch').getAttribute('data-layout')).toBe('flightDeck');
  });

  // First to load the chunk: later tests find it already cached, with no skeleton.
  it('shows a grey skeleton plane while Code City loads, then the city', async () => {
    render(<LayoutSwitch flightDeck={<p>deck body</p>} codeCity={codeCity} />);
    setLayout('codeCity');
    expect(screen.getByTestId('code-city-skeleton')).toBeTruthy();
    expect(await screen.findByTestId('code-city-stub')).toBeTruthy();
    expect(screen.queryByTestId('code-city-skeleton')).toBeNull();
  });

  it('opens on Code City when that is the saved layout', async () => {
    useUiPrefs.setState({ ticketLayout: 'codeCity' });
    render(<LayoutSwitch flightDeck={<p>deck body</p>} codeCity={codeCity} />);
    expect(await screen.findByTestId('code-city-stub')).toBeTruthy();
    expect(pane('flightDeck').style.display).toBe('none');
  });

  it('fades and slides the outgoing body toward the side it leaves and the incoming one in from the other side', async () => {
    render(<LayoutSwitch flightDeck={<p>deck body</p>} codeCity={codeCity} />);
    setLayout('codeCity');

    // First frame: the city is drawn at its start (clear, 24 px to the right), the deck still where it was.
    const city = pane('codeCity');
    expect(city.style.opacity).toBe('0');
    expect(city.style.transform).toBe(`translateX(${SLIDE_PX}px)`);
    expect(pane('flightDeck').style.opacity).toBe('1');

    // Then both move: the deck leaves 24 px to the left, the city arrives from 80 ms in; both 280 ms.
    await waitFor(() => expect(pane('codeCity').style.opacity).toBe('1'));
    expect(pane('flightDeck').style.opacity).toBe('0');
    expect(pane('flightDeck').style.transform).toBe(`translateX(${-SLIDE_PX}px)`);
    expect(pane('codeCity').style.transition).toContain(`${TRANSITION_MS}ms`);
    expect(pane('codeCity').style.transition).toContain(`${INCOMING_DELAY_MS}ms`);
    expect(pane('flightDeck').style.transition).toContain(`${TRANSITION_MS}ms`);

    // When it ends the old body is hidden but stays mounted.
    await waitFor(() => expect(pane('flightDeck').style.display).toBe('none'), { timeout: 2_000 });
    expect(screen.getByText('deck body')).toBeTruthy();
    expect(pane('codeCity').style.transform).toBe('');
  });

  it('goes back the other way, and keeps Code City mounted but hidden', async () => {
    render(<LayoutSwitch flightDeck={<p>deck body</p>} codeCity={codeCity} />);
    setLayout('codeCity');
    await waitFor(() => expect(pane('flightDeck').style.display).toBe('none'), { timeout: 2_000 });

    setLayout('flightDeck');
    // The deck arrives from the left; the city leaves to the right.
    expect(pane('flightDeck').style.transform).toBe(`translateX(${-SLIDE_PX}px)`);
    await waitFor(() => expect(pane('codeCity').style.transform).toBe(`translateX(${SLIDE_PX}px)`));
    await waitFor(() => expect(pane('codeCity').style.display).toBe('none'), { timeout: 2_000 });
    expect(screen.getByTestId('code-city-stub')).toBeTruthy();
    expect(pane('flightDeck').style.display).toBe('flex');
  });

  it('swaps instantly under prefers-reduced-motion', async () => {
    mockReducedMotion(true);
    render(<LayoutSwitch flightDeck={<p>deck body</p>} codeCity={codeCity} />);
    setLayout('codeCity');

    expect(pane('flightDeck').style.display).toBe('none');
    expect(pane('codeCity').style.transition).toBe('');
    expect(pane('codeCity').style.opacity).toBe('');
    expect(await screen.findByTestId('code-city-stub')).toBeTruthy();
  });
});
