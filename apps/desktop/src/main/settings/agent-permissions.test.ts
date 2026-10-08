import { agentPermissionMode, agentPermissionPolicy, defaultAgentPermissions, defaultSettings } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createSettingsService } from './service';
import { createMemorySettingsFile } from './settings-file';

describe('agent permission policy in settings (AL-109)', () => {
  it('is the D18 default until the user saves one, then survives a restart', () => {
    const file = createMemorySettingsFile();
    const service = createSettingsService({ file, warn: vi.fn() });
    expect(service.get().agentPermissions).toBeUndefined();
    expect(agentPermissionPolicy(service.get())).toEqual(defaultAgentPermissions());

    const policy = { edits: 'ask' as const, gitRead: true, buildAndTest: false, bashAllow: ['npm run lint'] };
    expect(service.update({ agentPermissions: policy }).ok).toBe(true);
    expect(createSettingsService({ file, warn: vi.fn() }).get().agentPermissions).toEqual(policy);
  });

  it('salvages a damaged saved policy field by field', () => {
    const warn = vi.fn();
    const service = createSettingsService({
      file: createMemorySettingsFile({ ...defaultSettings(), agentPermissions: { edits: 'never', gitRead: false, buildAndTest: true, bashAllow: [] } }),
      warn,
    });
    expect(service.get().agentPermissions).toEqual({ mode: 'auto', edits: 'accept', gitRead: false, buildAndTest: true, bashAllow: [] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('agentPermissions.edits'));
  });

  it('runs agents in auto mode unless the user picks another mode; a policy saved before modes keeps asking if it asked', () => {
    const service = createSettingsService({ file: createMemorySettingsFile(), warn: vi.fn() });
    expect(agentPermissionMode(agentPermissionPolicy(service.get()))).toBe('auto');

    // Saved before the mode existed: accepting edits becomes auto, asking for every edit stays ask.
    expect(agentPermissionMode({ edits: 'accept' })).toBe('auto');
    expect(agentPermissionMode({ edits: 'ask' })).toBe('ask');

    expect(service.update({ agentPermissions: { ...defaultAgentPermissions(), mode: 'accept-edits' } }).ok).toBe(true);
    expect(agentPermissionMode(agentPermissionPolicy(service.get()))).toBe('accept-edits');
    expect(service.update({ agentPermissions: { ...defaultAgentPermissions(), mode: 'sometimes' as never } }).ok).toBe(false);
  });
});
