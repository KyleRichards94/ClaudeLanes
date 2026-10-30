import { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { PEER_ASSIST_KINDS, PEER_POST_KINDS, type PeerPostKind, type PeerRoom, type RoomMessage } from '@agent-lanes/contracts';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Button, SegmentedControl, Text, TextField } from '@agent-lanes/ui';
import { KindPill, MemberRow, clock, peerStageLabel, useMinute } from '@/entities/peer';
import { useConnections, usePostToRoom, useRoomLog } from '@/shared/api';

const ASSIST = new Set<string>(PEER_ASSIST_KINDS);

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
 * A room's log (AL-295, AL-300, P9): who, when, the kind as a word, and the text in the agents' own
 * words, oldest first, with a quieter line when a lane joins, leaves or goes quiet. Unread `ask`,
 * `blocked` and `offer` rows are marked until the room has been shown.
 */
export function RoomLog({ room, focus = null, height = 360 }: { room: PeerRoom; focus?: string | null; height?: number }) {
  const log = useRoomLog(room.id);
  const list = useRef<FlatList<RoomMessage>>(null);
  const messages = log.data?.messages ?? [];
  const unread = unreadIds(messages, room.unread);
  // The message asked for, else the first unread one (the Assist bubble opens the panel there, AL-294).
  const target = focus ?? messages.find((message) => unread.has(message.id))?.id ?? null;
  const at = target ? messages.findIndex((message) => message.id === target) : -1;

  useEffect(() => {
    if (at >= 0) list.current?.scrollToIndex({ index: at, animated: false, viewPosition: 0 });
    else if (messages.length > 0) list.current?.scrollToEnd({ animated: false });
  }, [at, messages.length]);

  if (log.isError) {
    return (
      <Text variant="meta" color={tone.danger.text} role="alert">
        {`The room's log could not be read: ${log.error.message}`}
      </Text>
    );
  }
  return (
    <View style={[styles.log, { height }]} aria-live="polite" testID={`room-log-${room.parentId}`}>
      {log.data?.capped ? <Text variant="meta">Older messages were left out.</Text> : null}
      {messages.length === 0 && log.isSuccess ? <Text variant="meta">Nothing has been said in this room yet.</Text> : null}
      <FlatList
        ref={list}
        data={messages}
        keyExtractor={(message) => message.id}
        renderItem={({ item }) => <LogRow message={item} unread={unread.has(item.id)} />}
        onScrollToIndexFailed={() => list.current?.scrollToEnd({ animated: false })}
        contentContainerStyle={styles.rows}
      />
    </View>
  );
}

/** Who is in the room: this computer's lanes first, then other people's. */
export function RoomMembers({ room }: { room: PeerRoom }) {
  const now = useMinute();
  return (
    <View style={styles.members} testID={`room-members-${room.parentId}`}>
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
  log: {
    gap: space.xs,
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
