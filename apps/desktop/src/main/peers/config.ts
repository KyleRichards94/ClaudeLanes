import type { ConnectionsService } from '../connections';
import type { Logger } from '../logging';
import type { PeerNetwork } from './network';
import type { PeerTeams } from './teams';

/** What peer lanes runs with when there is no `peers` connection record. */
export interface PeerDefaults {
  port: number;
  beaconPort: number;
  /** e2e: everything stays on this computer (the listener and the beacon on loopback). */
  loopback: boolean;
}

export const RECHECK_TEAMS_MS = 60_000;

/**
 * Keeps the peer network on the app's teams and the Advanced settings (AL-298): on as soon as there
 * is a team, off with none; restarted when a port or the addresses change, and given new keys
 * without a restart when only the teams change.
 */
export interface PeerConfigSync {
  sync(): Promise<void>;
  /** Syncs now and every minute, so a project id ADO couldn't give at start-up is tried again. */
  start(): void;
  dispose(): void;
}

export function createPeerConfigSync(options: {
  connections: Pick<ConnectionsService, 'list'>;
  teams: PeerTeams;
  network: Pick<PeerNetwork, 'configure' | 'setTeams'>;
  defaults: PeerDefaults;
  log?: Pick<Logger, 'warn'>;
  /** The network was started, restarted, stopped or given new teams. */
  onApplied?: () => void;
  recheckMs?: number;
}): PeerConfigSync {
  let appliedSettings = 'off';
  let appliedTeams = '';
  let queue: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | null = null;

  async function apply(): Promise<void> {
    const row = (await options.connections.list()).find((item) => item.kind === 'peers');
    const settings =
      row?.kind === 'peers' ? { port: row.port, beaconPort: row.beaconPort, addresses: row.addresses } : { port: options.defaults.port, beaconPort: options.defaults.beaconPort, addresses: [] };
    const teams = await options.teams.current();
    const settingsKey = teams.length === 0 ? 'off' : JSON.stringify(settings);
    const teamsKey = teams
      .map((team) => team.tag)
      .sort()
      .join(',');
    if (settingsKey !== appliedSettings) {
      appliedSettings = settingsKey;
      appliedTeams = teamsKey;
      await options.network.configure(teams.length === 0 ? null : { ...settings, loopback: options.defaults.loopback, teams });
      options.onApplied?.();
    } else if (teamsKey !== appliedTeams) {
      appliedTeams = teamsKey;
      options.network.setTeams(teams);
      options.onApplied?.();
    }
  }

  function sync(): Promise<void> {
    queue = queue.then(apply).catch((cause) => options.log?.warn(`Peer lanes: could not apply the Peers settings: ${String(cause)}`));
    return queue;
  }

  return {
    sync,
    start() {
      timer ??= setInterval(() => void sync(), options.recheckMs ?? RECHECK_TEAMS_MS);
      timer.unref();
      void sync();
    },
    dispose() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
