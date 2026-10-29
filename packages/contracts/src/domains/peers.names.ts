/** Peer lanes and Feature rooms (E18, PL§4): status, rooms and the room log; never the team secret. Zod-free: imported by the sandboxed preload. */
export const PEERS_INVOKE_CHANNELS = [] as const;
export const PEERS_EVENT_CHANNELS = [
  // Listener up or failed, a peer came or went, a signature failure (AL-288).
  'peers:status',
] as const;
