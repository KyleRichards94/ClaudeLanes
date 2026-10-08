import { describe, expect, it } from 'vitest';
import { RepoSettingsSchema, SettingsPatchSchema, repoAdoWriteBack, type RepoSettings } from './settings.schemas';

const repo: RepoSettings = {
  path: 'C:\\src\\onsite-companion',
  name: 'onsite-companion',
  baseBranch: 'main',
  worktreeRoot: 'C:\\src\\.agent-lanes',
  buildCommand: null,
  runCommand: null,
  maxConcurrentAgents: 3,
};

describe('repo ADO write-back setting (AL-146)', () => {
  it('is optional, so repos saved before it stay valid, and means off when left out (opt-in)', () => {
    expect(RepoSettingsSchema.safeParse(repo).success).toBe(true);
    expect(repoAdoWriteBack(repo)).toBe(false);
    expect(repoAdoWriteBack({ ...repo, adoWriteBack: false })).toBe(false);
    expect(repoAdoWriteBack({ ...repo, adoWriteBack: true })).toBe(true);
  });

  it('can be switched on through a settings update and must be a boolean', () => {
    expect(SettingsPatchSchema.parse({ repos: [{ ...repo, adoWriteBack: true }] }).repos?.[0]?.adoWriteBack).toBe(true);
    expect(SettingsPatchSchema.safeParse({ repos: [{ ...repo, adoWriteBack: 'yes' }] }).success).toBe(false);
  });
});
