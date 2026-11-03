import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { FlatList } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PeerKind, PeerRoom, PeerRooms, RoomMessage } from '@agent-lanes/contracts';
import { roomLogQueryKey } from '@/shared/api';
import { fakeAdoRow, installFakeBridge } from '@/shared/testing';
import { closeRooms, openRooms } from '@/shared/model';
import { RoomLog } from './RoomLog';
import { RoomTab, RoomsPanel } from './RoomViews';
import { peerNetworkFixture } from '@agent-lanes/contracts/testing';

/** AL-295: the room log, the Rooms panel and the ticket's Room tab against the fake main process. */

const ROOM = 'https://dev.azure.com/contoso#48000';
let counter = 0;

function message(kind: PeerKind, text: string, overrides: Partial<RoomMessage> = {}): RoomMessage {
  counter += 1;
  return {
    v: 1,
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    room: ROOM,
    kind,
    from: { user: 'Kyle Richards', host: 'KYLE-PC', instance: '1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', person: false },
    lane: { ticketId: '71280', workItemId: 71280, title: 'Job DTO', stage: 'implementing', branch: '71280-job-dto', parentId: 48000 },
    text,
    data: {},
    sentAt: `2026-10-29T03:${String(10 + counter).padStart(2, '0')}:00.000Z`,
    replay: false,
    own: false,
    ...overrides,
  };
}

const own = message('ask', 'Status, and where can I help?', { own: true, from: { user: 'Mitch Healy', host: 'MITCH-PC', instance: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', person: false } });
const replayed = message('changed', 'Added JobDto.Status', { replay: true, data: { branch: '71280-job-dto', files: ['src/JobDto.cs'] } });
const live = message('blocked', 'Need the enum from #71273');
const messages = [own, replayed, live];

const room: PeerRoom = {
  id: ROOM,
  parentId: 48000,
  parentType: 'Feature',
  parentTitle: 'Job DTO',
  unread: 1,
  members: [
    { instance: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', user: 'Mitch Healy', host: 'MITCH-PC', lane: { ticketId: '71273', workItemId: 71273, title: 'Cutover', stage: 'implementing', branch: '71273-x', parentId: 48000 }, touched: [], lastSeenAt: Date.now(), local: true, reachable: true },
    { instance: '1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', user: 'Kyle Richards', host: 'KYLE-PC', lane: { ticketId: '71280', workItemId: 71280, title: 'Job DTO', stage: 'implementing', branch: '71280-job-dto', parentId: 48000 }, touched: [], lastSeenAt: Date.now(), local: false, reachable: true },
  ],
};
const rooms: PeerRooms = { rooms: [room], others: [] };

function setup(children: ReactNode, replies: Parameters<typeof installFakeBridge>[0] = {}) {
  const bridge = installFakeBridge({
    'connections:list': { ok: true, data: [fakeAdoRow({ identity: 'Mitch Healy' })] },
    'peers:list': { ok: true, data: peerNetworkFixture({ listener: { state: 'listening', port: 47811, message: null } }) },
    'peers:rooms': { ok: true, data: rooms },
    'peers:log': { ok: true, data: { room: ROOM, messages, capped: false } },
    'peers:markSeen': { ok: true, data: { total: 0, byRoom: {}, byTicket: {} } },
    ...replies,
  });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>);
  return bridge;
}

afterEach(() => act(() => closeRooms()));

describe('room log (AL-295)', () => {
  it('shows own, replayed and live rows in order, with the kind as a word', async () => {
    setup(<RoomLog room={room} />);
    await screen.findByTestId(`room-message-${live.id}`);
    const rows = [own, replayed, live].map((item) => screen.getByTestId(`room-message-${item.id}`));
    expect(rows.map((row) => within(row).getByText(/^(Ask|Changed|Blocked)$/).textContent)).toEqual(['Ask', 'Changed', 'Blocked']);
    expect(rows[0]?.textContent).toContain('Mitch Healy · #71280 (Implementing)');
    expect(rows[1]?.textContent).toContain('said earlier');
    expect(rows[1]?.textContent).toContain('branch 71280-job-dto · src/JobDto.cs');
    expect(rows[2]?.textContent).toContain('Kyle Richards · KYLE-PC · #71280 (Implementing)');
    expect(rows[2]?.textContent).toContain('new');
    // Rows appear in the DOM in the same order.
    expect(rows[0]!.compareDocumentPosition(rows[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens the Rooms panel on the room, lists its members, and marks the unread blocked seen', async () => {
    const bridge = setup(<RoomsPanel />);
    act(() => openRooms());
    expect((await screen.findByTestId('room-heading')).textContent).toBe('Feature #48000 · Job DTO');
    expect(screen.getByTestId('room-members-count-48000').textContent).toBe('In the room · 2');
    expect(screen.getByTestId('room-member-71273').textContent).toBe('Mitch Healy (you) · MITCH-PC · #71273 Cutover · Implementing');
    expect(screen.getByTestId('room-member-71280').textContent).toMatch(/^Kyle Richards · KYLE-PC · #71280 Job DTO · Implementingseen /);
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('peers:markSeen', { room: ROOM, upTo: live.id }));
    expect(screen.getByTestId(`room-message-${live.id}`).textContent).toContain('new');
  });

  it("shows the ticket's room on its Room tab, or says why there is none", async () => {
    setup(<RoomTab ticketId="71273" />);
    expect((await screen.findByTestId('room-heading')).textContent).toBe('Feature #48000 · Job DTO');
  });

  it('says so when the ticket is in no room', async () => {
    setup(<RoomTab ticketId="71330" />);
    expect((await screen.findByTestId('room-tab')).textContent).toContain('This ticket is in no room');
  });

  it('points to Connections when peer lanes is off', async () => {
    setup(<RoomTab ticketId="71273" />, { 'peers:list': { ok: true, data: peerNetworkFixture({ listener: { state: 'off', port: null, message: null } }) } });
    await waitFor(() => expect(screen.getByTestId('room-tab').textContent).toContain('Peer lanes is off'));
  });
});

describe('room composer (AL-295)', () => {
  it('sends the post as the person, with the kind picked', async () => {
    const sent = { ...message('answer', 'Use JobStatus'), own: true, from: { user: 'Mitch Healy', host: 'MITCH-PC', instance: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', person: true }, lane: null };
    const bridge = setup(<RoomsPanel />, { 'peers:post': { ok: true, data: sent } });
    act(() => openRooms());
    await screen.findByTestId('room-post-text');
    fireEvent.click(within(screen.getByTestId('room-post-kind')).getByRole('radio', { name: 'Answer' }));
    fireEvent.change(screen.getByTestId('room-post-text'), { target: { value: 'Use JobStatus' } });
    fireEvent.click(screen.getByTestId('room-post'));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('peers:post', { room: ROOM, kind: 'answer', text: 'Use JobStatus' }));
    expect((await screen.findByTestId(`room-message-${sent.id}`)).textContent).toContain('Mitch Healy (person)');
    await waitFor(() => expect((screen.getByTestId('room-post-text') as HTMLInputElement).value).toBe(''));
  });
});

describe('the room as a chat room (AL-300)', () => {
  const joined = message('hello', '', { system: 'joined', sentAt: '2026-10-30T10:42:00.000Z' });
  const mine = message('hello', '', { system: 'joined', own: true, sentAt: '2026-10-30T10:43:00.000Z', from: own.from });
  const left = message('bye', '', { system: 'lost', sentAt: '2026-10-30T10:44:00.000Z' });
  const withRows = [own, replayed, live, joined, mine, left];

  it('shows joins, leaves and lost contact as quiet lines with the time, never as new', async () => {
    setup(<RoomLog room={room} />, { 'peers:log': { ok: true, data: { room: ROOM, messages: withRows, capped: false } } });
    const line = await screen.findByTestId(`room-system-${joined.id}`);
    const time = (at: string) => new Date(at).toTimeString().slice(0, 5);
    expect(line.textContent).toBe(`Kyle Richards's agent joined on #71280 · ${time(joined.sentAt)}`);
    expect(screen.getByTestId(`room-system-${mine.id}`).textContent).toBe(`Your agent joined on #71280 · ${time(mine.sentAt)}`);
    expect(screen.getByTestId(`room-system-${left.id}`).textContent).toBe(`Lost contact with Kyle Richards's agent on #71280 · ${time(left.sentAt)}`);
    expect(screen.queryByTestId(`room-message-${joined.id}`)).toBeNull();
    expect(screen.getByTestId(`room-system-${left.id}`).textContent).not.toContain('new');
  });

  it('marks the room seen up to its last post when a system row comes after it', async () => {
    const bridge = setup(<RoomsPanel />, { 'peers:log': { ok: true, data: { room: ROOM, messages: withRows, capped: false } } });
    act(() => openRooms());
    await screen.findByTestId(`room-system-${left.id}`);
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('peers:markSeen', { room: ROOM, upTo: live.id }));
  });
});

describe('one scroll region, like a chat (AL-300)', () => {
  const scrollers = (root: HTMLElement) =>
    [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))].filter((element) => ['auto', 'scroll'].includes(getComputedStyle(element).overflowY));

  it('scrolls only the log in the Rooms panel, between the members and the composer', async () => {
    setup(<RoomsPanel />);
    act(() => openRooms());
    const log = await screen.findByTestId('room-log-48000');
    const panel = screen.getByTestId('rooms-panel-panel');
    const scrolling = scrollers(panel);
    expect(scrolling).toHaveLength(1);
    expect(log.contains(scrolling[0]!)).toBe(true);
    expect(getComputedStyle(log).flexGrow).toBe('1');
    expect(getComputedStyle(log).height).not.toMatch(/px$/);
    expect(log.contains(screen.getByTestId('room-composer-48000'))).toBe(false);
    expect(log.contains(screen.getByTestId('room-members-48000'))).toBe(false);
  });

  it('scrolls only the log on the Room tab', async () => {
    setup(<RoomTab ticketId="71273" />);
    const log = await screen.findByTestId('room-log-48000');
    const scrolling = scrollers(screen.getByTestId('room-tab'));
    expect(scrolling).toHaveLength(1);
    expect(log.contains(scrolling[0]!)).toBe(true);
    expect(getComputedStyle(screen.getByTestId('room-tab')).flexGrow).toBe('1');
  });
});

describe('the log follows new messages like a chat app (AL-301)', () => {
  const toEnd = vi.spyOn(FlatList.prototype, 'scrollToEnd');
  afterEach(() => toEnd.mockClear());

  function mount(children: ReactNode): QueryClient {
    installFakeBridge({
      'connections:list': { ok: true, data: [fakeAdoRow({ identity: 'Mitch Healy' })] },
      'peers:list': { ok: true, data: peerNetworkFixture() },
      'peers:rooms': { ok: true, data: rooms },
      'peers:log': { ok: true, data: { room: ROOM, messages, capped: false } },
      'peers:markSeen': { ok: true, data: { total: 0, byRoom: {}, byTicket: {} } },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
    return client;
  }

  /** The log's scrolling element, given a fake height: 1000 px of rows in a 400 px view, scrolled to `top`. */
  function scrollLog(top: number): void {
    const log = screen.getByTestId('room-log-48000');
    const list = Array.from(log.querySelectorAll<HTMLElement>('*')).find((element) => getComputedStyle(element).overflowY === 'auto')!;
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1_000 });
    Object.defineProperty(list, 'offsetHeight', { configurable: true, value: 400 });
    Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: top });
    fireEvent.scroll(list);
  }

  /** New rows in the cache, as `peers:message` puts them there; React Query tells the log on the next tick. */
  async function arrive(client: QueryClient, ...added: RoomMessage[]): Promise<void> {
    await act(async () => {
      client.setQueryData(roomLogQueryKey(ROOM), (log: { messages: RoomMessage[] }) => ({ ...log, messages: [...log.messages, ...added] }));
      await new Promise((done) => setTimeout(done, 0));
    });
  }

  const pill = () => screen.queryByTestId('room-new-messages');

  it('opens the Room tab and the Rooms panel at the bottom', async () => {
    mount(<RoomTab ticketId="71273" />);
    await screen.findByTestId(`room-message-${live.id}`);
    expect(toEnd).toHaveBeenCalled();
    toEnd.mockClear();
    act(() => openRooms());
    mount(<RoomsPanel />);
    await waitFor(() => expect(toEnd).toHaveBeenCalled());
  });

  it('scrolls a new post into view when pinned at the bottom, with no pill', async () => {
    const client = mount(<RoomLog room={room} />);
    await screen.findByTestId(`room-message-${live.id}`);
    scrollLog(600);
    toEnd.mockClear();
    await arrive(client, message('ask', 'Who has the mapper?'));
    expect(toEnd).toHaveBeenCalled();
    expect(pill()).toBeNull();
  });

  it('leaves the view where it is when scrolled up, counts new posts on the pill, and the pill lands on the last row', async () => {
    const client = mount(<RoomLog room={room} />);
    await screen.findByTestId(`room-message-${live.id}`);
    scrollLog(100);
    toEnd.mockClear();
    await arrive(client, message('ask', 'Who has the mapper?'));
    expect(toEnd).not.toHaveBeenCalled();
    expect(pill()?.textContent).toBe('New messages');
    await arrive(client, message('changed', 'Pushed JobStatus'));
    expect(pill()?.textContent).toBe('2 new messages');
    fireEvent.click(screen.getByRole('button', { name: '2 new messages' }));
    expect(toEnd).toHaveBeenCalled();
    expect(pill()).toBeNull();
  });

  it('clears the pill when the user scrolls to the bottom by hand', async () => {
    const client = mount(<RoomLog room={room} />);
    await screen.findByTestId(`room-message-${live.id}`);
    scrollLog(100);
    await arrive(client, message('ask', 'Who has the mapper?'));
    expect(pill()).not.toBeNull();
    scrollLog(600);
    await waitFor(() => expect(pill()).toBeNull());
  });

  it('raises no pill for a joined row while scrolled up, and follows the person’s own post', async () => {
    const client = mount(<RoomLog room={room} />);
    await screen.findByTestId(`room-message-${live.id}`);
    scrollLog(100);
    toEnd.mockClear();
    await arrive(client, message('hello', '', { system: 'joined' }));
    expect(pill()).toBeNull();
    expect(toEnd).not.toHaveBeenCalled();
    await arrive(client, message('ask', 'Status?', { own: true, from: { ...own.from, person: true } }));
    expect(toEnd).toHaveBeenCalled();
    expect(pill()).toBeNull();
  });

  it('makes the pill a button named by its text, reachable by Tab, inside the log and clear of the composer', async () => {
    const client = mount(<RoomsPanel />);
    act(() => openRooms());
    await screen.findByTestId(`room-message-${live.id}`);
    scrollLog(100);
    await arrive(client, message('ask', 'Who has the mapper?'));
    const button = screen.getByRole('button', { name: 'New messages' });
    expect(button.tabIndex).toBe(0);
    expect(screen.getByTestId('room-log-48000').contains(button)).toBe(true);
    expect(screen.getByTestId('room-composer-48000').contains(button)).toBe(false);
  });
});
