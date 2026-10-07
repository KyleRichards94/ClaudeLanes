import { join } from 'node:path';
import { defaultSettings } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import { handleInvoke } from '../ipc/handle-invoke';
import { createSettingsHandlers } from './handlers';
import { createRepoSettings } from './repo-settings';
import { createSettingsService } from './service';
import { createMemorySettingsFile } from './settings-file';

const osc = createRepoSettings(join('C:', 'src', 'onsite-companion'));
const lanes = createRepoSettings(join('C:', 'src', 'agent-lanes'));

function setup(stored?: unknown) {
  const file = createMemorySettingsFile(stored);
  const service = createSettingsService({ file, warn: vi.fn() });
  return { file, service, handlers: createSettingsHandlers(service) };
}

describe('settings IPC handlers', () => {
  it('settings:get returns the current settings', async () => {
    const { handlers } = setup();
    await expect(handleInvoke('settings:get', undefined, handlers['settings:get'])).resolves.toEqual({
      ok: true,
      data: defaultSettings(),
    });
  });

  it('settings:update applies a partial update and returns the new settings', async () => {
    const { handlers, file } = setup();
    const result = await handleInvoke('settings:update', { ui: { collapsedLanes: ['qa', 'done'] } }, handlers['settings:update']);

    expect(result.ok && result.data.ui.collapsedLanes).toEqual(['qa', 'done']);
    expect(file.writes).toBe(1);
  });

  it('settings:update refuses a request outside the contract before it reaches the store', async () => {
    const { handlers, file } = setup();
    const result = await handleInvoke('settings:update', { ui: { collapsedLanes: 'qa' } }, handlers['settings:update']);

    expect(!result.ok && result.code).toBe('VALIDATION');
    expect(file.writes).toBe(0);
  });

  it('settings:update needs a request', async () => {
    const { handlers } = setup();
    const result = await handleInvoke('settings:update', undefined, handlers['settings:update']);
    expect(!result.ok && result.code).toBe('VALIDATION');
  });

  describe('repos from the renderer', () => {
    it('can change, reorder and remove registered repos', async () => {
      const { handlers, service } = setup({ ...defaultSettings(), repos: [osc, lanes] });
      const edited = { ...lanes, baseBranch: 'develop', runCommand: 'pnpm dev' };

      const result = await handleInvoke('settings:update', { repos: [edited] }, handlers['settings:update']);

      expect(result.ok).toBe(true);
      expect(service.get().repos).toEqual([edited]);
    });

    it('cannot register a new repo path; that takes the folder picker in main', async () => {
      const { handlers, service, file } = setup({ ...defaultSettings(), repos: [osc] });

      const result = await handleInvoke('settings:update', { repos: [osc, lanes] }, handlers['settings:update']);

      expect(result).toMatchObject({ ok: false, code: 'VALIDATION', details: { paths: [lanes.path] } });
      expect(service.get().repos).toEqual([osc]);
      expect(file.writes).toBe(0);
    });

    it('main services can still register repos through the service', () => {
      const { service } = setup();
      expect(service.update({ repos: [osc] }).ok).toBe(true);
    });
  });
});
