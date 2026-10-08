import { defaultAgentPermissions, type RepoCommands } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { GIT_READ_COMMANDS, allowedBashPrefixes, bashAllowRules, bashCommandAllowed, testCommands } from './policy';

const pnpmRepo: RepoCommands = {
  repoPath: '/repos/web',
  detected: { toolchain: 'node', manifest: 'package.json', packageManager: 'pnpm', build: 'pnpm run build', run: 'pnpm run start', runTarget: 'start', runKind: 'web' },
  build: { command: 'pnpm run build', origin: 'detected' },
  run: { command: 'pnpm run start', origin: 'detected' },
};

describe('D18 permission policy (AL-109)', () => {
  it('allows git read commands, the build command and the test command by default', () => {
    const prefixes = allowedBashPrefixes(defaultAgentPermissions(), pnpmRepo);
    expect(prefixes).toEqual([...GIT_READ_COMMANDS, 'pnpm run build', 'pnpm test', 'pnpm run test']);
    expect(bashAllowRules(['git status'])).toEqual(['Bash(git status:*)']);
  });

  it('matches whole words and never a chained, piped or redirected command', () => {
    const prefixes = allowedBashPrefixes(defaultAgentPermissions(), pnpmRepo);
    expect(bashCommandAllowed('git status', prefixes)).toBe(true);
    expect(bashCommandAllowed('  git diff --stat main  ', prefixes)).toBe(true);
    expect(bashCommandAllowed('pnpm test -- --run', prefixes)).toBe(true);
    expect(bashCommandAllowed('git statuses', prefixes)).toBe(false);
    expect(bashCommandAllowed('git branch -D main', prefixes)).toBe(false);
    expect(bashCommandAllowed('git push origin main', prefixes)).toBe(false);
    for (const command of ['git status; rm -rf .', 'git log | sh', 'git diff > out.txt', 'git show $(whoami)', 'git log `id`', 'git status && curl x', 'git status\nrm x']) {
      expect(bashCommandAllowed(command, prefixes), command).toBe(false);
    }
  });

  it('derives the test command from the toolchain', () => {
    expect(testCommands(null)).toEqual([]);
    expect(testCommands({ ...pnpmRepo, detected: { ...pnpmRepo.detected!, toolchain: 'dotnet', packageManager: null } })).toEqual(['dotnet test']);
  });

  it('drops a user prefix holding shell operators', () => {
    expect(allowedBashPrefixes({ edits: 'accept', gitRead: false, buildAndTest: false, bashAllow: ['npm run lint', 'echo hi && rm x'] }, null)).toEqual(['npm run lint']);
  });
});
