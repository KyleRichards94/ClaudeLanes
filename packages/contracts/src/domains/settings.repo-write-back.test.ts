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
  it('is optional, so repos saved before it stay valid, and means on when left out', () => {
    expect(RepoSettingsSchema.safeParse(repo).success).toBe(true);
    expect(repoAdoWriteBack(repo)).toBe(true);
    expect(repoAdoWriteBack({ ...repo, adoWriteBack: false })).toBe(false);
  });

  it('can be switched off through a settings update and must be a boolean', () => {
    expect(SettingsPatchSchema.parse({ repos: [{ ...repo, adoWriteBack: false }] }).repos?.[0]?.adoWriteBack).toBe(false);
    expect(SettingsPatchSchema.safeParse({ repos: [{ ...repo, adoWriteBack: 'no' }] }).success).toBe(false);
  });
});
