import { useRef, useState, type RefObject } from 'react';
import { DEFAULT_PEER_PORT, parsePeerAddress, type PeersConnectionSummary } from '@agent-lanes/contracts';
import type { SecureTextFieldHandle } from '@agent-lanes/ui';
import { useDraftTest, type ConnectionDraftController, type DraftStatus, type DraftTest } from '@/entities/connection';
import { useReplaceConnection, useSaveConnection, type ConnectionDraftInput } from '@/shared/api';

/** A new team secret: 24 random bytes, URL-safe base64. */
export function generateTeamSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function portError(port: string): string | null {
  const value = Number(port.trim());
  return Number.isInteger(value) && value >= 1 && value <= 65_535 ? null : 'Use a port from 1 to 65535.';
}

export function peerError(address: string, all: readonly string[]): string | null {
  const text = address.trim();
  if (text === '') return null;
  if (!parsePeerAddress(text)) return `Use a computer name or IP address, with :port when it isn't ${DEFAULT_PEER_PORT}.`;
  return all.filter((other) => other.trim().toLowerCase() === text.toLowerCase()).length > 1 ? 'Listed twice.' : null;
}

export interface PeersDraft extends ConnectionDraftController {
  replacing: PeersConnectionSummary | null;
  port: string;
  setPort(value: string): void;
  portError: string | null;
  /** One row per peer; an empty row is ignored. */
  peers: string[];
  setPeer(index: number, value: string): void;
  addPeer(): void;
  removePeer(index: number): void;
  peerErrors: Array<string | null>;
  secretRef: RefObject<SecureTextFieldHandle | null>;
  secretFilled: boolean;
  onSecretChange(filled: boolean): void;
  /** A secret Generate made, shown so it can be shared; null when the user typed one. */
  generated: string | null;
  generate(): void;
  test: DraftTest;
  canTest: boolean;
  runTest(): Promise<void>;
  startReplace(row: PeersConnectionSummary): void;
  cancelReplace(): void;
  saveError: string | null;
}

/** The Peers tab's draft (AL-289): this app's port, the team secret and the peers it dials. */
export function usePeersDraft(): PeersDraft {
  const test = useDraftTest();
  const saveConnection = useSaveConnection();
  const replaceConnection = useReplaceConnection();
  const secretRef = useRef<SecureTextFieldHandle | null>(null);
  const [replacing, setReplacing] = useState<PeersConnectionSummary | null>(null);
  const [port, setPortState] = useState(String(DEFAULT_PEER_PORT));
  const [peers, setPeers] = useState<string[]>(['']);
  const [secretFilled, setSecretFilled] = useState(false);
  const [generated, setGenerated] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const listed = peers.map((peer) => peer.trim()).filter(Boolean);
  const peerErrors = peers.map((peer) => peerError(peer, peers));
  const badPort = portError(port);
  const hasSecret = secretFilled || generated !== null;
  const typed = hasSecret || listed.length > 0 || port.trim() !== String(DEFAULT_PEER_PORT);
  const status: DraftStatus = test.state === 'passed' ? 'passed' : typed || replacing ? 'untested' : 'empty';

  function edited() {
    test.reset();
    setSaveError(null);
  }

  function clear() {
    secretRef.current?.clear();
    setSecretFilled(false);
    setGenerated(null);
    setReplacing(null);
    setPortState(String(DEFAULT_PEER_PORT));
    setPeers(['']);
    setSaveError(null);
    test.reset();
  }

  function draft(secret: string): ConnectionDraftInput {
    return { kind: 'peers', port: Number(port.trim()), peers: listed, ...(secret ? { teamSecret: secret } : {}) };
  }

  return {
    replacing,
    port,
    setPort(value) {
      setPortState(value);
      edited();
    },
    portError: badPort,
    peers,
    setPeer(index, value) {
      setPeers((current) => current.map((peer, at) => (at === index ? value : peer)));
      edited();
    },
    addPeer() {
      setPeers((current) => [...current, '']);
    },
    removePeer(index) {
      setPeers((current) => (current.length === 1 ? [''] : current.filter((_, at) => at !== index)));
      edited();
    },
    peerErrors,
    secretRef,
    secretFilled,
    onSecretChange(filled) {
      setSecretFilled(filled);
      if (filled) setGenerated(null);
      edited();
    },
    generated,
    generate() {
      secretRef.current?.clear();
      setSecretFilled(false);
      setGenerated(generateTeamSecret());
      edited();
    },
    test,
    // A Replace may keep the saved secret; a first save needs one.
    canTest: !badPort && peerErrors.every((error) => error === null) && (hasSecret || replacing !== null) && test.state !== 'testing',
    async runTest() {
      setSaveError(null);
      await test.run(draft(generated ?? secretRef.current?.read() ?? ''));
    },
    startReplace(row) {
      secretRef.current?.clear();
      setSecretFilled(false);
      setGenerated(null);
      setReplacing(row);
      setPortState(String(row.port));
      setPeers(row.peers.length > 0 ? [...row.peers] : ['']);
      setSaveError(null);
      test.reset();
    },
    cancelReplace: clear,
    status,
    saving: saveConnection.isPending || replaceConnection.isPending,
    saveError,
    async save() {
      if (status !== 'passed') return;
      const request = draft(generated ?? secretRef.current?.take() ?? '');
      setSecretFilled(false);
      try {
        if (replacing) await replaceConnection.mutateAsync({ id: replacing.id, draft: request });
        else await saveConnection.mutateAsync(request);
        clear();
      } catch (error) {
        test.reset();
        setSaveError(error instanceof Error ? error.message : 'Saving failed.');
        throw error;
      }
    },
    clear,
  };
}
