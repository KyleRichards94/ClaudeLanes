import { useEffect, useRef, useState, type RefObject } from 'react';
import { FlatList, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { PEER_ASSIST_KINDS, PEER_POST_KINDS, type PeerPostKind, type PeerRoom, type RoomMessage } from '@agent-lanes/contracts';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Button, SegmentedControl, Text, TextField } from '@agent-lanes/ui';
import { KindPill, MemberRow, clock, peerStageLabel, useMinute } from '@/entities/peer';
import { useConnections, usePostToRoom, useRoomLog } from '@/shared/api';
import { arrivals, atBottom, newMessagesLabel } from '../model/follow';

const ASSIST = new Set<string>(PEER_ASSIST_KINDS);
const NO_MESSAGES: RoomMessage[] = [];

/** `Kyle Richards · KYLE-PC · #48161 (Implementing)`, or `Mitch Healy (person)`. */
export function messageSpeaker(message: RoomMessage): string {
  if (message.from.person) return `${message.from.user} (person)`;
  const lane = message.lane;
  const item = lane ? ` · ${lane.workItemId ? `#${lane.workItemId}` : lane.title} (${peerStageLabel(lane.stage)})` : '';
  return `${message.from.user}${message.own ? '' : ` · ${message.from.host}`}${item}`;
}

/** `Kyle Richards's agent joined on #51439 · 10:42`: a system row (AL-300) as one line. */
export function systemText(message: RoomMessage): string {
  const who = message.own ? 'Your agent' : `${message.from.user}'s agent`;
  const item = message.lane?.workItemId ? ` on #${message.lane.workItemId}` : message.lane ? ` on ${message.lane.title}` : '';
  const time = clock(Date.parse(message.sentAt));
  if (message.system === 'joined') return `${who} joined${item} · ${time}`;
  if (message.system === 'left') return `${who} left${item} · ${time}`;
  return `Lost contact with ${message.own ? 'your agent' : `${message.from.user}'s agent`}${item} · ${time}`;
}

/** The newest `count` ask, blocked and offer messages from others: what the Assist bubble counts. */
export function unreadIds(messages: readonly RoomMessage[], count: number): Set<string> {
  if (count <= 0) return new Set();
  const candidates = messages.filter((message) => !message.system && !message.own && !message.replay && ASSIST.has(message.kind));
  return new Set(candidates.slice(-count).map((message) => message.id));
}

function SystemRow({ message }: { message: RoomMessage }) {
  return (
    <View style={styles.system} testID={`room-system-${message.id}`}>
      <Text variant="meta" size="sm" color={message.system === 'lost' ? tone.attention.text : undefined}>
        {systemText(message)}
      </Text>
    </View>
  );
}

function LogRow({ message, unread }: { message: RoomMessage; unread: boolean }) {
  if (message.system) return <SystemRow message={message} />;
  return (
    <View style={[styles.row, unread ? styles.unread : null]} testID={`room-message-${message.id}`}>
      <View style={styles.rowTop}>
        <Text variant="meta">{clock(Date.parse(message.sentAt))}</Text>
        <KindPill kind={message.kind} />
        <Text variant="meta" size="md" numberOfLines={1} style={styles.grow}>
          {messageSpeaker(message)}
        </Text>
        {message.replay ? <Text variant="meta">said earlier</Text> : null}
        {unread ? (
          <Text variant="meta" color={tone.attention.text}>
            new
          </Text>
        ) : null}
      </View>
      <Text variant="body" size="sm" selectable>
        {message.text}
      </Text>
      {message.data.to || message.data.branch || message.data.files?.length ? (
        <Text variant="mono" size="xs" numberOfLines={2} selectable>
          {[
            message.data.to ? `to ${message.data.to.user} on #${message.data.to.workItemId}` : null,
            message.data.branch ? `branch ${message.data.branch}` : null,
            message.data.files?.length ? message.data.files.join(', ') : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Follows the log like a chat app (AL-301): opens at the bottom (or the message asked for), stays
 * pinned there as rows arrive, and otherwise leaves the view where it is and counts the new posts for
 * the pill. Reaching the bottom, by hand or with the pill, clears the count.
 */
function useFollow(messages: readonly RoomMessage[], list: RefObject<FlatList<RoomMessage> | null>, focus: string | null) {
  const [pinned, setPinned] = useState(true);
  const [follow, setFollow] = useState<{ list: readonly RoomMessage[]; unseen: number; scroll: { n: number; to: number | 'end' } }>({ list: NO_MESSAGES, unseen: 0, scroll: { n: 0, to: 'end' } });

  // New rows are worked out as they render; the effect below only moves the view.
  if (follow.list !== messages && messages.length > 0) {
    if (follow.list.length === 0) {
      const at = focus ? messages.findIndex((message) => message.id === focus) : -1;
      setFollow({ list: messages, unseen: 0, scroll: { n: follow.scroll.n + 1, to: at >= 0 ? at : 'end' } });
    } else {
      const known = new Set(follow.list.map((message) => message.id));
      const next = arrivals(
        messages.filter((message) => !known.has(message.id)),
        pinned,
      );
      setFollow({ list: messages, unseen: next.follow ? 0 : follow.unseen + next.unseen, scroll: next.follow ? { n: follow.scroll.n + 1, to: 'end' } : follow.scroll });
    }
  }

  useEffect(() => {
    if (follow.scroll.n === 0) return;
    const to = follow.scroll.to;
    if (to === 'end') list.current?.scrollToEnd({ animated: false });
    else list.current?.scrollToIndex({ index: to, animated: false, viewPosition: 0 });
  }, [follow.scroll, list]);

  return {
    unseen: follow.unseen,
    jump() {
      setPinned(true);
      setFollow((current) => ({ ...current, unseen: 0, scroll: { n: current.scroll.n + 1, to: 'end' } }));
    },
    onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
      const bottom = atBottom(event.nativeEvent);
      setPinned(bottom);
      if (bottom) setFollow((current) => (current.unseen > 0 ? { ...current, unseen: 0 } : current));
    },
    // Rows that arrive while pinned are measured after the scroll above: keep the view at the end.
    onContentSizeChange() {
      if (pinned) list.current?.scrollToEnd({ animated: false });
    },
  };
}

/**
 * A room's log (AL-295, AL-300, AL-301, P9): who, when, the kind as a word, and the text in the agents'
 * own words, oldest first, with a quieter line when a lane joins, leaves or goes quiet. Unread `ask`,
 * `blocked` and `offer` rows are marked until the room has been shown.
 */
export function RoomLog({ room, focus = null }: { room: PeerRoom; focus?: string | null }) {
  const log = useRoomLog(room.id);
  const list = useRef<FlatList<RoomMessage>>(null);
  const messages = log.data?.messages ?? NO_MESSAGES;
  const unread = unreadIds(messages, room.unread);
  const follow = useFollow(messages, list, focus);

  if (log.isError) {
    return (
      <Text variant="meta" color={tone.danger.text} role="alert">
        {`The room's log could not be read: ${log.error.message}`}
      </Text>
    );
  }
  return (
    <View style={styles.log} aria-live="polite" testID={`room-log-${room.parentId}`}>
      {log.data?.capped ? <Text variant="meta">Older messages were left out.</Text> : null}
      {messages.length === 0 && log.isSuccess ? <Text variant="meta">Nothing has been said in this room yet.</Text> : null}
      <FlatList
        ref={list}
        data={messages}
        keyExtractor={(message) => message.id}
        renderItem={({ item }) => <LogRow message={item} unread={unread.has(item.id)} />}
        onScrollToIndexFailed={() => list.current?.scrollToEnd({ animated: false })}
        onScroll={follow.onScroll}
        onContentSizeChange={follow.onContentSizeChange}
        scrollEventThrottle={50}
        style={styles.list}
        contentContainerStyle={styles.rows}
      />
      {follow.unseen > 0 ? (
        <View style={styles.newSlot}>
          <Button label={newMessagesLabel(follow.unseen)} variant="primary" size="sm" onPress={follow.jump} testID="room-new-messages" />
        </View>
      ) : null}
    </View>
  );
}

/** Who is in the room (AL-300): this computer's lanes first, then other people's, always in view. */
export function RoomMembers({ room }: { room: PeerRoom }) {
  const now = useMinute();
  return (
    <View style={styles.members} testID={`room-members-${room.parentId}`}>
      <Text variant="meta" testID={`room-members-count-${room.parentId}`}>{`In the room · ${room.members.length}`}</Text>
      {room.members.map((member) => (
        <MemberRow key={`${member.instance}/${member.lane.ticketId}`} member={member} now={now} testID={`room-member-${member.lane.ticketId}`} />
      ))}
    </View>
  );
}

const PERSON_KINDS: readonly PeerPostKind[] = ['ask', 'answer', 'blocked', 'offer'];

/**
 * The person's composer (AL-295): what the user posts goes out as them, `from.person`, not as an agent,
 * and reaches every lane's agent in the room with "(person)" after their name.
 */
export function RoomComposer({ room }: { room: PeerRoom }) {
  const connections = useConnections();
  const me = connections.data?.find((row) => row.kind === 'ado' && row.identity)?.identity ?? 'You';
  const post = usePostToRoom(me);
  const [kind, setKind] = useState<PeerPostKind>('ask');
  const [text, setText] = useState('');
  const trimmed = text.trim();

  function send() {
    if (!trimmed || post.isPending) return;
    post.mutate({ room: room.id, kind, text: trimmed }, { onSuccess: () => setText('') });
  }

  return (
    <View style={styles.composer} testID={`room-composer-${room.parentId}`}>
      <SegmentedControl<PeerPostKind>
        label="Kind of post"
        tone="ink"
        value={kind}
        onChange={setKind}
        options={PERSON_KINDS.filter((item) => (PEER_POST_KINDS as readonly string[]).includes(item)).map((item) => ({ value: item, label: item[0]?.toUpperCase() + item.slice(1) }))}
        testID="room-post-kind"
      />
      <View style={styles.composerRow}>
        <TextField aria-label="Post to the room" placeholder="One line to everyone in the room" value={text} onChangeText={setText} onSubmitEditing={send} style={styles.grow} testID="room-post-text" />
        <Button label="Post" variant="primary" disabled={!trimmed} loading={post.isPending} onPress={send} testID="room-post" />
      </View>
      {post.isError ? (
        <Text variant="meta" color={tone.danger.text} role="alert">
          {post.error.message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The one part of a room that scrolls (AL-300): it takes whatever height is left.
  log: {
    flex: 1,
    minHeight: 0,
    gap: space.xs,
  },
  list: {
    flex: 1,
  },
  // Over the bottom edge of the log, so it never covers the composer below it.
  newSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: space.sm,
    alignItems: 'center',
    pointerEvents: 'box-none',
  },
  rows: {
    gap: space.xs,
  },
  row: {
    gap: 2,
    padding: space.sm,
    borderRadius: radius.control,
    backgroundColor: color.surface,
  },
  unread: {
    backgroundColor: tone.attention.band,
  },
  system: {
    alignItems: 'center',
    paddingVertical: 2,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  grow: {
    flex: 1,
    flexShrink: 1,
  },
  members: {
    gap: space.xs,
  },
  composer: {
    gap: space.sm,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
});
