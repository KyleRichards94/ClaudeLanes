/** Peer lanes and Feature rooms (E18, PL§4): status, rooms and the room log; never the team secret. Zod-free: imported by the sandboxed preload. */
export const PEERS_INVOKE_CHANNELS = [
  // Listed peers with status, and the listener (AL-289: the Peers tab's status dots).
  'peers:list',
  // Rooms this app is in with their members, and peers' lanes elsewhere (AL-290).
  'peers:rooms',
  // A room's log as this app has it: own, replayed and live messages, oldest first (AL-291).
  'peers:log',
  // A person's post from the Room tab, and clearing the Assist bubble up to a message (AL-292).
  'peers:post',
  'peers:markSeen',
] as const;
export const PEERS_EVENT_CHANNELS = [
  // Listener up or failed, a peer came or went, a signature failure (AL-288).
  'peers:status',
  // A lane joined, changed, left or expired (AL-290).
  'peers:presence',
  // A room message arrived or was sent, with the unread counts (AL-292).
  'peers:message',
] as const;
