import { describe, expect, it } from 'vitest';
import { normaliseRule, ruleAllows, suggestedRule } from './rules';

describe('permission rules (AL-260)', () => {
  it('suggests a Bash prefix with the sub-command for git-like tools, and the tool name otherwise', () => {
    expect(suggestedRule('Bash', { command: 'dotnet build "OnSite Companion Solution.sln" -c Debug' })).toBe('Bash(dotnet build:*)');
    expect(suggestedRule('Bash', { command: 'git status' })).toBe('Bash(git status:*)');
    expect(suggestedRule('Bash', { command: 'ls -la' })).toBe('Bash(ls:*)');
    expect(suggestedRule('Bash', { command: 'rm -rf x && echo y' })).toBeNull();
    expect(suggestedRule('WebFetch', { url: 'https://x' })).toBe('WebFetch');
    expect(suggestedRule('mcp__azure-devops__wit_get_work_item', {})).toBe('mcp__azure-devops__wit_get_work_item');
  });

  it('lets a call through a matching rule only', () => {
    expect(ruleAllows('Bash(dotnet build:*)', 'Bash', { command: 'dotnet build App.sln' })).toBe(true);
    expect(ruleAllows('Bash(dotnet build:*)', 'Bash', { command: 'dotnet test App.sln' })).toBe(false);
    expect(ruleAllows('Bash(dotnet build:*)', 'Bash', { command: 'dotnet build App.sln && rm x' })).toBe(false);
    expect(ruleAllows('WebFetch', 'WebFetch', {})).toBe(true);
    expect(ruleAllows('WebFetch', 'Bash', { command: 'curl' })).toBe(false);
    expect(normaliseRule(' Bash(git status:*) ')).toBe('Bash(git status:*)');
    expect(normaliseRule('Read')).toBe('Read');
    expect(normaliseRule('rm -rf')).toBeNull();
  });
});
