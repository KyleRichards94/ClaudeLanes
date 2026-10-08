import type { SKILLS_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import type { Services } from '../services';

/** `skills:list` (AL-114): a registered repo's skills, as Claude Code lists them. */
export function createSkillsHandlers({ skills }: Pick<Services, 'skills'>): HandlersFor<(typeof SKILLS_INVOKE_CHANNELS)[number]> {
  return {
    'skills:list': ({ repo, refresh }) => skills.list(repo, { refresh: refresh ?? false }),
  };
}
