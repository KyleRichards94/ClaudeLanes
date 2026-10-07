import { describe, expect, it } from 'vitest';
import { pickSprint, SprintListSchema, SprintSchema, type Sprint, type SprintList, type SprintTimeFrame } from './ado.schemas';

function sprint(n: number, timeFrame: SprintTimeFrame, start: string | null = null, finish: string | null = null): Sprint {
  return { id: `iteration-${n}`, name: `Sprint ${n}`, path: `Onsite Companion\\Sprint ${n}`, start, finish, timeFrame };
}

const sprint41 = sprint(41, 'past', '2026-09-23', '2026-10-06');
const sprint42 = sprint(42, 'current', '2026-10-07', '2026-10-20');
const sprint43 = sprint(43, 'future', '2026-10-21', '2026-11-03');

const list = (sprints: Sprint[], currentId: string | null = null): SprintList => ({ sprints, currentId });

describe('SprintSchema', () => {
  it('accepts the artboard 1 sprint', () => {
    expect(SprintSchema.parse(sprint42)).toEqual(sprint42);
  });

  it('accepts a sprint without dates', () => {
    expect(SprintSchema.safeParse(sprint(50, 'future')).success).toBe(true);
  });

  it.each([
    ['an instant instead of a calendar day', { start: '2026-10-07T00:00:00Z' }],
    ['an impossible date', { finish: '2026-02-30' }],
    ['an unknown time frame', { timeFrame: 'later' }],
    ['an empty path', { path: '' }],
  ])('refuses %s', (_case, change) => {
    expect(SprintSchema.safeParse({ ...sprint42, ...change }).success).toBe(false);
  });
});

describe('SprintListSchema', () => {
  it('accepts a list whose current sprint is the one named by currentId', () => {
    expect(SprintListSchema.safeParse(list([sprint41, sprint42, sprint43], sprint42.id)).success).toBe(true);
    expect(SprintListSchema.safeParse(list([sprint41, sprint43])).success).toBe(true);
  });

  it.each([
    ['currentId names no sprint', list([sprint41, sprint43], 'iteration-99')],
    ['currentId names a sprint that is not current', list([sprint41, sprint43], sprint41.id)],
    ['a current sprint without currentId', list([sprint41, sprint42])],
    ['two current sprints', list([sprint42, { ...sprint43, timeFrame: 'current' }], sprint42.id)],
  ])('refuses %s', (_case, value) => {
    expect(SprintListSchema.safeParse(value).success).toBe(false);
  });
});

describe('pickSprint', () => {
  const sprints = list([sprint41, sprint42, sprint43], sprint42.id);

  it('pre-selects the current sprint', () => {
    expect(pickSprint(sprints)).toBe(sprint42);
    expect(pickSprint(sprints, null)).toBe(sprint42);
  });

  it('keeps a past or future sprint the user selected', () => {
    expect(pickSprint(sprints, sprint41.id)).toBe(sprint41);
    expect(pickSprint(sprints, sprint43.id)).toBe(sprint43);
  });

  it('falls back to the current sprint when the selected one is gone', () => {
    expect(pickSprint(sprints, 'iteration-17')).toBe(sprint42);
  });

  it('between sprints, picks the next one to start', () => {
    const sprint44 = sprint(44, 'future', '2026-11-04', '2026-11-17');
    expect(pickSprint(list([sprint41, sprint43, sprint44]))).toBe(sprint43);
  });

  it('with only past sprints, picks the latest', () => {
    const sprint40 = sprint(40, 'past', '2026-09-09', '2026-09-22');
    expect(pickSprint(list([sprint40, sprint41]))).toBe(sprint41);
  });

  it('returns null when the team has no sprints', () => {
    expect(pickSprint(list([]))).toBeNull();
    expect(pickSprint(list([]), sprint42.id)).toBeNull();
  });
});
