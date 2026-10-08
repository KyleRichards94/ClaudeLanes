import { agentPermissionPolicy, defaultAgentPermissions, defaultSettings } from '@agent-lanes/contracts';
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
    expect(service.get().agentPermissions).toEqual({ edits: 'accept', gitRead: false, buildAndTest: true, bashAllow: [] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('agentPermissions.edits'));
  });
});
