import { ok, type BUILD_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import type { Services } from '../services';

export function createBuildHandlers({ buildQueue }: Pick<Services, 'buildQueue'>): HandlersFor<(typeof BUILD_INVOKE_CHANNELS)[number]> {
  return {
    'build:listJobs': () => ok({ concurrency: buildQueue.concurrency(), jobs: buildQueue.list() }),
    'build:cancel': ({ jobId }) => ok({ cancelled: buildQueue.cancel(jobId) }),
  };
}
