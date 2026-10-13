import { describe, expect, it } from 'vitest';
import { allowedLanes, type DropCard } from '../drop-rules';
import { SettingsPatchSchema, SettingsSchema, defaultSettings } from './settings.schemas';
import { DROP_KINDS, defaultDropDefaults, dropDefaultsOf, dropKindOf } from './settings.drops';

const me = { id: 'me' };
const mine = { id: 'me', displayName: 'Kyle Richards' };

describe('per-lane drop defaults (AL-240)', () => {
  it('are seeded from the TB§3 table', () => {
    expect(defaultDropDefaults()).toEqual({
      planning: { skills: [], model: 'opus', effort: 'high', prompt: '' },
      implementing: { skills: [], model: 'opus', effort: 'high', prompt: '' },
      'answer-comments': { skills: ['pr-comment-actioner'], model: 'sonnet', effort: 'high', prompt: '' },
      'code-review': { skills: ['code-review', 'pr-comment-actioner'], model: 'opus', effort: 'high', prompt: '' },
      qa: { skills: ['cs-qa-wip'], model: 'sonnet', effort: 'medium', prompt: '' },
      'review-only': { skills: ['code-review'], model: 'opus', effort: 'high', prompt: '' },
      'qa-only': { skills: ['cs-qa-wip'], model: 'sonnet', effort: 'medium', prompt: '' },
      'pr-only': { skills: [], model: 'sonnet', effort: 'medium', prompt: '' },
      'comments-only': { skills: ['pr-comment-actioner'], model: 'sonnet', effort: 'high', prompt: '' },
    });
  });

  it("match the drop rules' own defaults row by row", () => {
    const cards: DropCard[] = [
      { kind: 'board-item', id: 1, column: 'failed', assignee: null, agentLane: null, pullRequestId: null, branch: null },
      { kind: 'board-item', id: 2, column: 'testing', assignee: mine, agentLane: null, pullRequestId: null, branch: 'b' },
      { kind: 'pull-request', id: 3, author: mine, unresolvedThreads: 2, sourceBranch: 's', repoRegistered: true },
    ];
    const seen = new Set<string>();
    for (const card of cards) {
      for (const action of Object.values(allowedLanes(card, me))) {
        const kind = dropKindOf(action);
        seen.add(kind);
        const { prompt: _prompt, ...row } = defaultDropDefaults()[kind];
        expect({ skills: action.skills.map((skill) => skill.replace(/^\//, '')), model: action.model, effort: action.effort }, kind).toEqual(row);
      }
    }
    expect([...seen].toSorted()).toEqual([...DROP_KINDS].toSorted());
  });

  it('are optional in settings, a saved row wins, and a row saved before its lane existed takes the default', () => {
    expect(SettingsSchema.safeParse(defaultSettings()).success).toBe(true);
    const drops = { ...defaultDropDefaults(), qa: { skills: ['cs-qa'], model: 'haiku' as const, effort: 'low' as const } };
    expect(SettingsPatchSchema.safeParse({ dropDefaults: drops }).success).toBe(true);
    // Settings saved before the single-step lanes and the initial prompt: the missing rows take their defaults.
    expect(SettingsPatchSchema.safeParse({ dropDefaults: { qa: drops.qa } }).success).toBe(true);
    expect(dropDefaultsOf({ dropDefaults: { qa: drops.qa } })['comments-only']).toEqual(defaultDropDefaults()['comments-only']);
    expect(SettingsPatchSchema.safeParse({ dropDefaults: { qa: { ...drops.qa, prompt: 'x'.repeat(4001) } } }).success).toBe(false);
    expect(dropDefaultsOf({ dropDefaults: drops }).qa).toEqual({ skills: ['cs-qa'], model: 'haiku', effort: 'low', prompt: '' });
    expect(dropDefaultsOf({})).toEqual(defaultDropDefaults());
  });
});
