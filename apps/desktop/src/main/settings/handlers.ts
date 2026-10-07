import { err, ok, type RepoSettings, type SETTINGS_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import type { SettingsService } from './service';

export function createSettingsHandlers(settings: SettingsService): HandlersFor<(typeof SETTINGS_INVOKE_CHANNELS)[number]> {
  return {
    'settings:get': () => ok(settings.get()),
    'settings:update': (patch) => {
      // Repo paths come only from the native folder dialog in main (design §8, AL-081). The renderer
      // may edit, reorder or remove registered repos, but never register a path of its own.
      const added = newRepoPaths(settings.get().repos, patch.repos);
      if (added.length > 0) {
        return err('VALIDATION', 'New repos are added with the folder picker, not settings:update', { paths: added });
      }
      return settings.update(patch);
    },
  };
}

function newRepoPaths(current: readonly RepoSettings[], next: readonly RepoSettings[] | undefined): string[] {
  if (!next) return [];
  const registered = new Set(current.map((repo) => repo.path));
  return next.map((repo) => repo.path).filter((path) => !registered.has(path));
}
