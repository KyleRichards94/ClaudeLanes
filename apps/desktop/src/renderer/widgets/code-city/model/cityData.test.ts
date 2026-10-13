import { describe, expect, it } from 'vitest';
import { accessibleName, authorOf, crewStatus, faceColors, nudgeLabels, pinsFor, CHIP_HEIGHT, CHIP_GAP } from './cityData';
import { fixtureAgents, FIXTURE_PATHS, fixtureFiles } from './fixture';
import type { CityAgent } from './types';

const agent = (fields: Partial<CityAgent>): CityAgent => ({
  id: 'a',
  name: 'a',
  model: null,
  color: '#000000',
  role: 'sub',
  status: 'running',
  activeFile: null,
  activeKind: 'idle',
  ...fields,
});

describe('authorOf', () => {
  it('finds the author agent and its colour', () => {
    expect(authorOf(fixtureFiles[0]!, fixtureAgents)).toMatchObject({ name: 'lead', color: '#5B4BC4' });
  });

  it('is grey "you or a merge" for a null or unknown author', () => {
    expect(authorOf({ authorAgentId: null }, fixtureAgents)).toMatchObject({ name: 'you or a merge', color: '#94A3B8', agent: null });
    expect(authorOf({ authorAgentId: 'gone' }, fixtureAgents)).toMatchObject({ name: 'you or a merge', color: '#94A3B8' });
  });
});

describe('faceColors', () => {
  it('lightens the top and darkens the right face', () => {
    expect(faceColors('#5B4BC4')).toEqual({ c1: '#B5AEE4', c2: '#7466CD', c3: '#493C9D' });
  });
});

describe('accessibleName', () => {
  it('follows the handoff wording', () => {
    expect(accessibleName({ name: 'A.razor', district: 'Pages / X', added: 120, removed: 0, author: 'lead', review: 'inReview', binary: false })).toBe(
      'A.razor, Pages / X, 120 lines added, 0 removed, by lead, In review',
    );
  });
});

describe('pinsFor', () => {
  const paths = new Set([FIXTURE_PATHS.razor, FIXTURE_PATHS.razorCs]);

  it('pins running agents whose active file is in the city', () => {
    const pins = pinsFor(fixtureAgents, paths);
    expect(pins.map((p) => `${p.agent.name}:${p.verb}`)).toEqual(['builder:building', 'reviewer:inspecting']);
  });

  it('skips idle agents, ended sessions and files outside the diff', () => {
    expect(pinsFor([agent({ activeFile: FIXTURE_PATHS.razor, activeKind: 'idle' })], paths)).toEqual([]);
    expect(pinsFor([agent({ status: 'done', activeFile: FIXTURE_PATHS.razor, activeKind: 'edit' })], paths)).toEqual([]);
    expect(pinsFor([agent({ activeFile: 'elsewhere.cs', activeKind: 'read' })], paths)).toEqual([]);
  });

  it('uses a verb per activity kind', () => {
    const verbs = (['edit', 'review', 'test', 'read'] as const).map((k) => pinsFor([agent({ activeFile: FIXTURE_PATHS.razor, activeKind: k })], paths)[0]?.verb);
    expect(verbs).toEqual(['building', 'inspecting', 'testing', 'reading']);
  });
});

describe('crewStatus', () => {
  const paths = new Set([FIXTURE_PATHS.razor]);

  it('names what each agent is doing', () => {
    expect(crewStatus(agent({ role: 'lead' }), paths).word).toBe('Directing');
    expect(crewStatus(agent({ activeFile: FIXTURE_PATHS.razor, activeKind: 'review' }), paths).word).toBe('Inspecting');
    expect(crewStatus(agent({ activeFile: FIXTURE_PATHS.razor, activeKind: 'edit' }), paths).word).toBe('Building');
    expect(crewStatus(agent({ activeFile: FIXTURE_PATHS.razor, activeKind: 'test' }), paths).word).toBe('Testing');
    expect(crewStatus(agent({ status: 'done' }), paths).word).toBe('Off shift');
    expect(crewStatus(agent({ status: 'idle' }), paths).word).toBe('Off shift');
    expect(crewStatus(agent({ status: 'error' }), paths).word).toBe('Stopped');
  });

  it('says Reading for a file outside the diff', () => {
    expect(crewStatus(agent({ activeFile: 'unchanged.cs', activeKind: 'read' }), paths).word).toBe('Reading');
    expect(crewStatus(agent({ activeFile: 'unchanged.cs', activeKind: 'edit' }), paths).word).toBe('Reading');
  });
});

describe('nudgeLabels', () => {
  const box = (key: string, x: number, y: number) => ({ key, x, y, w: 100, h: CHIP_HEIGHT });

  it('leaves labels that do not overlap where they are', () => {
    expect(nudgeLabels([box('a', 100, 200), box('b', 400, 200)])).toEqual({ a: 0, b: 0 });
  });

  it('moves the later of two overlapping labels up by its height plus 4', () => {
    expect(nudgeLabels([box('a', 100, 200), box('b', 120, 200)])).toEqual({ a: 0, b: CHIP_HEIGHT + 4 });
  });

  it('gives up after 3 passes', () => {
    const labels = Array.from({ length: 6 }, (_, i) => box(`l${i}`, 100, 200));
    const offsets = nudgeLabels(labels);
    expect(Math.max(...Object.values(offsets))).toBeLessThanOrEqual(3 * (CHIP_HEIGHT + 4));
    // The first three stack cleanly: 0, 30, 60.
    expect([offsets.l0, offsets.l1, offsets.l2]).toEqual([0, 30, 60]);
  });

  it('steers clear of fixed rectangles such as district labels', () => {
    const fixed = [{ left: 50, right: 150, top: 200 - CHIP_GAP - CHIP_HEIGHT, bottom: 200 - CHIP_GAP }];
    expect(nudgeLabels([box('a', 100, 200)], fixed)).toEqual({ a: CHIP_HEIGHT + 4 });
  });
});
