import { describe, expect, it } from 'vitest';
import { describeSpecDiff, designSpecStatus, diffSpecArtboards, isAgentWatchingDesign, type DesignSpecArtboard } from './design.specs';

const control: DesignSpecArtboard = { id: 'JobControl.html', name: 'JobControl · desktop', width: 1440, height: 900, source: '<main/>' };
const filter: DesignSpecArtboard = { id: 'JobFilter.html', name: 'JobFilter · side panel', width: 420, height: 900, source: '<aside/>' };
const empty: DesignSpecArtboard = { id: 'Empty.html', name: 'Empty state', width: 600, height: 320, source: null };

describe('design spec status (AL-198, AL-199)', () => {
  it('is Superseded once a later version exists, Used once acknowledged, Sent before', () => {
    expect(designSpecStatus({ version: 1, usedAt: 5 }, 2)).toBe('superseded');
    expect(designSpecStatus({ version: 2, usedAt: 5 }, 2)).toBe('used');
    expect(designSpecStatus({ version: 2, usedAt: null }, 2)).toBe('sent');
  });

  it('the agent is watching while the latest spec is fetched and not acknowledged', () => {
    expect(isAgentWatchingDesign([])).toBe(false);
    expect(isAgentWatchingDesign([{ usedAt: null, fetchedAt: 5 }])).toBe(true);
    expect(isAgentWatchingDesign([{ usedAt: null }])).toBe(false);
    expect(isAgentWatchingDesign([{ usedAt: 6, fetchedAt: 5 }])).toBe(false);
    expect(isAgentWatchingDesign([{ usedAt: null, fetchedAt: 5 }, { usedAt: null, fetchedAt: null }])).toBe(false);
  });
});

describe('diffing two versions of a design (AL-199)', () => {
  it('lists added, removed, changed and unchanged artboards by name', () => {
    const diff = diffSpecArtboards({ artboards: [control, filter] }, { artboards: [{ ...control, width: 1600 }, empty] });
    expect(diff).toEqual({ added: ['Empty state'], removed: ['JobFilter · side panel'], changed: ['JobControl · desktop'], unchanged: [] });
    expect(describeSpecDiff(diff, 1)).toBe('Since v1: added Empty state · removed JobFilter · side panel · changed JobControl · desktop');
  });

  it('says when the artboards are the same', () => {
    const diff = diffSpecArtboards({ artboards: [control, filter] }, { artboards: [control, filter] });
    expect(diff.unchanged).toEqual(['JobControl · desktop', 'JobFilter · side panel']);
    expect(describeSpecDiff(diff, 2)).toBe('Same artboards as v2');
  });
});
