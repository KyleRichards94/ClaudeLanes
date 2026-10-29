import type { Result } from '@agent-lanes/contracts';
import type { Logger } from '../logging';
import { deriveTeam, type PeerTeamKey } from './signer';

/** An ADO organisation and project this app works in, by the project's name. */
export interface TeamSource {
  orgUrl: string;
  project: string;
}

export interface PeerTeams {
  /** A key per organisation and project in `sources`, for the projects whose id could be read. */
  current(): Promise<PeerTeamKey[]>;
}

/**
 * The teams this app is in (AL-298, PL§11). Each project's id is read from Azure DevOps once and
 * kept in memory; one that can't be read now is tried again on the next call.
 */
export function createPeerTeams(options: {
  sources: () => Promise<TeamSource[]>;
  projectId: (orgUrl: string, project: string) => Promise<Result<string>>;
  log?: Pick<Logger, 'warn'>;
}): PeerTeams {
  const ids = new Map<string, string>();
  const warned = new Set<string>();

  return {
    async current() {
      const teams = new Map<string, PeerTeamKey>();
      for (const source of await options.sources()) {
        const at = `${source.orgUrl.trim().replace(/\/+$/, '').toLowerCase()}\n${source.project.trim().toLowerCase()}`;
        let id = ids.get(at);
        if (id === undefined) {
          const read = await options.projectId(source.orgUrl, source.project);
          if (!read.ok) {
            if (!warned.has(at)) options.log?.warn(`Peer lanes: the id of project ${source.project} could not be read, so it has no team yet: ${read.message}`);
            warned.add(at);
            continue;
          }
          id = read.data;
          ids.set(at, id);
          warned.delete(at);
        }
        const team = deriveTeam(source.orgUrl, id);
        teams.set(team.tag, team);
      }
      return [...teams.values()];
    },
  };
}
