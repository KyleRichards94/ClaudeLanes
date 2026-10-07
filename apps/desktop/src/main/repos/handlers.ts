import { ok, type REPOS_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import type { Services } from '../services';

export function createReposHandlers({ repos }: Pick<Services, 'repos'>): HandlersFor<(typeof REPOS_INVOKE_CHANNELS)[number]> {
  return {
    'repos:list': () => ok(repos.list()),
    'repos:add': () => repos.add(),
    'repos:remove': ({ path }) => repos.remove(path),
  };
}
