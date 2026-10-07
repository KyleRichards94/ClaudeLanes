import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Text, View } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeBridge, type FakeBridge } from '@/shared/testing';
import { LaneErrorBoundary, PageErrorBoundary, PanelErrorBoundary, TicketErrorBoundary } from './boundaries';

/** Ticket ids (and `lane:<title>`) whose render throws. */
let broken: Set<string>;

function Card({ id }: { id: string }) {
  if (broken.has(id)) throw new TypeError("Cannot read properties of undefined (reading 'stage')");
  return <Text testID={`card-${id}`}>Card #{id}</Text>;
}

function Lane({ title, ids }: { title: string; ids: string[] }) {
  if (broken.has(`lane:${title}`)) throw new Error('lane selector failed');
  return (
    <View testID={`lane-${title}`}>
      <Text>{title}</Text>
      {ids.map((id) => (
        <TicketErrorBoundary key={id} ticketId={id}>
          <Card id={id} />
        </TicketErrorBoundary>
      ))}
    </View>
  );
}

/** A stand-in for the board (AL-143 lanes, AL-144 cards) wired the way design §12 asks. */
function Board() {
  return (
    <View>
      <LaneErrorBoundary lane="Planning">
        <Lane title="Planning" ids={['101', '102', '103']} />
      </LaneErrorBoundary>
      <LaneErrorBoundary lane="Implementing">
        <Lane title="Implementing" ids={['201', '202']} />
      </LaneErrorBoundary>
    </View>
  );
}

function logged(bridge: FakeBridge) {
  return vi
    .mocked(bridge.invoke)
    .mock.calls.filter(([channel]) => channel === 'app:logError')
    .map(([, report]) => report as { boundary?: string; message?: string });
}

let bridge: FakeBridge;

beforeEach(() => {
  broken = new Set();
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

describe('board boundaries', () => {
  it("leaves the rest of the board working when one card's render throws", async () => {
    broken.add('102');
    render(<Board />);

    expect(screen.getByRole('heading', { name: 'Something went wrong in ticket #102' })).toBeTruthy();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    // The broken card's neighbours in its lane and the other lane all still render.
    for (const id of ['101', '103', '201', '202']) expect(screen.getByTestId(`card-${id}`)).toBeTruthy();
    expect(screen.queryByTestId('card-102')).toBeNull();
    expect(within(screen.getByTestId('lane-Planning')).getByTestId('error-fallback')).toBeTruthy();

    await waitFor(() => expect(logged(bridge)).toEqual([expect.objectContaining({ boundary: 'card:102' })]));
  });

  it('brings a card back on Retry once it renders again', () => {
    broken.add('201');
    render(<Board />);

    broken.clear();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByTestId('card-201')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('contains a failing lane to that lane', async () => {
    broken.add('lane:Implementing');
    render(<Board />);

    expect(screen.getByRole('heading', { name: 'Something went wrong in the Implementing lane' })).toBeTruthy();
    for (const id of ['101', '102', '103']) expect(screen.getByTestId(`card-${id}`)).toBeTruthy();
    await waitFor(() =>
      expect(logged(bridge)).toEqual([
        expect.objectContaining({ boundary: 'lane:Implementing', message: 'lane selector failed' }),
      ]),
    );
  });
});

function Broken({ message }: { message: string }): never {
  throw new Error(message);
}

describe('panel boundaries', () => {
  it.each([
    ['output', 'the output panel'],
    ['subAgents', 'the sub-agents panel'],
    ['designView', 'the Claude Design view'],
  ] as const)('names the %s panel and leaves the page around it working', async (panel, label) => {
    render(
      <View>
        <Text>Ticket header</Text>
        <PanelErrorBoundary panel={panel} ticketId="71273">
          <Broken message={`${panel} failed`} />
        </PanelErrorBoundary>
      </View>,
    );

    expect(screen.getByRole('heading', { name: `Something went wrong in ${label}` })).toBeTruthy();
    expect(screen.getByText('Ticket header')).toBeTruthy();
    await waitFor(() =>
      expect(logged(bridge)).toEqual([expect.objectContaining({ boundary: `panel:${panel}:71273` })]),
    );
  });
});

describe('PageErrorBoundary', () => {
  it('logs as page:<route> and offers Retry', async () => {
    render(
      <PageErrorBoundary page="board" label="the board">
        <Broken message="board failed" />
      </PageErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: 'Something went wrong in the board' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    await waitFor(() => expect(logged(bridge)).toEqual([expect.objectContaining({ boundary: 'page:board' })]));
  });
});
