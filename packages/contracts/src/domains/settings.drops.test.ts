import { describe, expect, it } from 'vitest';
import { allowedLanes, type DropCard } from '../drop-rules';
import { SettingsPatchSchema, SettingsSchema, defaultSettings } from './settings.schemas';
import { DROP_KINDS, defaultDropDefaults, dropDefaultsOf, dropKindOf } from './settings.drops';

const me = { id: 'me' };
const mine = { id: 'me', displayName: 'Kyle Richards' };

describe('per-lane drop defaults (AL-240)', () => {
  it('are seeded from the TB§3 table', () => {
    expect(defaultDropDefaults()).toEqual({
      planning: { skills: [], model: 'opus', effort: 'high' },
      implementing: { skills: [], model: 'opus', effort: 'high' },
      'answer-comments': { skills: ['pr-comment-actioner'], model: 'sonnet', effort: 'high' },
      'code-review': { skills: ['code-review', 'pr-comment-actioner'], model: 'opus', effort: 'high' },
      qa: { skills: ['cs-qa-wip'], model: 'sonnet', effort: 'medium' },
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
        expect({ skills: action.skills.map((skill) => skill.replace(/^\//, '')), model: action.model, effort: action.effort }, kind).toEqual(defaultDropDefaults()[kind]);
      }
    }
    expect([...seen].toSorted()).toEqual([...DROP_KINDS].toSorted());
  });

  it('are optional in settings, saved whole through a patch, and a saved row wins', () => {
    expect(SettingsSchema.safeParse(defaultSettings()).success).toBe(true);
    const drops = { ...defaultDropDefaults(), qa: { skills: ['cs-qa'], model: 'haiku' as const, effort: 'low' as const } };
    expect(SettingsPatchSchema.safeParse({ dropDefaults: drops }).success).toBe(true);
    expect(SettingsPatchSchema.safeParse({ dropDefaults: { qa: drops.qa } }).success).toBe(false);
    expect(dropDefaultsOf({ dropDefaults: drops }).qa).toEqual({ skills: ['cs-qa'], model: 'haiku', effort: 'low' });
    expect(dropDefaultsOf({})).toEqual(defaultDropDefaults());
  });
});
