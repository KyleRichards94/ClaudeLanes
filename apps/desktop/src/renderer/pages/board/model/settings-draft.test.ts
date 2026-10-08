import { defaultSettings, type RepoSettings, type Settings } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { draftFromSettings, draftReducer, draftToPatch, parseSkills, repoErrorKey, validateDraft, type DraftAction } from './settings-draft';

const osc: RepoSettings = {
  path: 'C:\\src\\onsite-companion',
  name: 'onsite-companion',
  baseBranch: 'main',
  worktreeRoot: 'C:\\src\\.agent-lanes',
  buildCommand: null,
  runCommand: null,
  maxConcurrentAgents: 3,
};
const lanes: RepoSettings = { ...osc, path: 'C:\\src\\agent-lanes', name: 'agent-lanes', adoWriteBack: false };

function settings(): Settings {
  return { ...defaultSettings(), repos: [osc, lanes], defaults: { ...defaultSettings().defaults, skills: ['code-review'] } };
}

function apply(...actions: DraftAction[]) {
  return actions.reduce(draftReducer, draftFromSettings(settings()));
}

describe('settings draft', () => {
  it('saves nothing when nothing changed', () => {
    const draft = apply();
    expect(draft.skills).toBe('/code-review');
    expect(validateDraft(draft, settings().repos)).toEqual({});
    expect(draftToPatch(draft, settings())).toEqual({});
  });

  it('patches only the global fields that changed', () => {
    const draft = apply(
      { type: 'model', model: 'sonnet' },
      { type: 'gate', stage: 'qa', gate: 'approval' },
      { type: 'text', field: 'skills', value: '/code-review, cs-qa-wip /code-review' },
      { type: 'text', field: 'buildQueueSize', value: ' 4 ' },
      { type: 'adoStateTransitions', value: true },
    );
    expect(draftToPatch(draft, settings())).toEqual({
      defaults: {
        model: 'sonnet',
        stageGates: { planning: 'approval', implementing: 'auto', 'code-review': 'auto', qa: 'approval', 'create-pr': 'approval' },
        skills: ['code-review', 'cs-qa-wip'],
      },
      buildQueueSize: 4,
      adoStateTransitions: true,
    });
  });

  it('sends every repo when one changed, with blank commands meaning the detected ones', () => {
    const draft = apply(
      { type: 'repoText', repo: osc, field: 'buildCommand', value: '  dotnet build OnSite.sln -c Release ' },
      { type: 'repoText', repo: osc, field: 'baseBranch', value: 'develop' },
      { type: 'repoText', repo: osc, field: 'maxConcurrentAgents', value: '5' },
      { type: 'repoWriteBack', repo: osc, value: true },
      { type: 'repoText', repo: lanes, field: 'runCommand', value: '   ' },
    );
    expect(draftToPatch(draft, settings())).toEqual({
      repos: [
        { ...osc, baseBranch: 'develop', buildCommand: 'dotnet build OnSite.sln -c Release', maxConcurrentAgents: 5, adoWriteBack: true },
        lanes,
      ],
    });
  });

  it('keeps repos that were added or removed since the form opened', () => {
    const draft = apply({ type: 'repoText', repo: osc, field: 'name', value: 'OSC' });
    const now: Settings = { ...settings(), repos: [osc] };
    expect(draftToPatch(draft, now)).toEqual({ repos: [{ ...osc, name: 'OSC' }] });
  });

  it('names each invalid field', () => {
    const draft = apply(
      { type: 'text', field: 'buildQueueSize', value: '9' },
      { type: 'text', field: 'skills', value: '/code review!' },
      { type: 'repoText', repo: osc, field: 'baseBranch', value: 'my branch' },
      { type: 'repoText', repo: osc, field: 'worktreeRoot', value: '.agent-lanes' },
      { type: 'repoText', repo: osc, field: 'maxConcurrentAgents', value: '0' },
      { type: 'repoText', repo: osc, field: 'name', value: ' ' },
    );
    expect(validateDraft(draft, settings().repos)).toEqual({
      buildQueueSize: 'Enter a whole number from 1 to 8.',
      skills: '"review!" is not a skill name. Use names like /code-review.',
      [repoErrorKey(osc, 'name')]: 'Give the repo a name.',
      [repoErrorKey(osc, 'baseBranch')]: 'A branch name has no spaces.',
      [repoErrorKey(osc, 'worktreeRoot')]: 'Enter a full folder path, such as C:\\src\\.agent-lanes.',
      [repoErrorKey(osc, 'maxConcurrentAgents')]: 'Enter a whole number from 1 to 16.',
    });
  });

  it('reads skill lists with or without slashes', () => {
    expect(parseSkills(' /a, b  /c,,a ')).toEqual(['a', 'b', 'c']);
    expect(parseSkills('')).toEqual([]);
  });

  it('saves the agent permission policy only when it changed (AL-109)', () => {
    expect(draftToPatch(apply({ type: 'permission', field: 'gitRead', value: true }), settings())).toEqual({});
    const draft = apply({ type: 'permission', field: 'acceptEdits', value: false }, { type: 'bashAllow', value: 'npm run lint,  dotnet format, npm run lint' });
    expect(validateDraft(draft, settings().repos)).toEqual({});
    expect(draftToPatch(draft, settings())).toEqual({
      agentPermissions: { edits: 'ask', gitRead: true, buildAndTest: true, bashAllow: ['npm run lint', 'dotnet format'] },
    });
  });

  it('refuses a permitted command that chains or redirects (AL-109)', () => {
    const draft = apply({ type: 'bashAllow', value: 'npm test && rm -rf .' });
    expect(validateDraft(draft, settings().repos)['bashAllow']).toContain('chains or redirects');
  });
});
