import { describe, expect, it } from 'vitest';
import { COLLAPSE_MARGIN_PX, STRIP_MAX_CHIPS, isAgentBoardCollapsed, stripCell, stripChipLabel } from './agent-strip';

describe('isAgentBoardCollapsed', () => {
  // Lanes end 520 px into the content; the pinned header ends 80 px from the top of the scroll area,
  // so the lanes are all under it at 440 px and fold 96 px before that.
  const at = (scrollY: number) => isAgentBoardCollapsed({ scrollY, lanesBottom: 520, headerBottom: 80 });
  const foldsAt = 440 - COLLAPSE_MARGIN_PX + 1;

  it('stays expanded at the top and while more than the margin of the lanes shows below the header', () => {
    expect(at(0)).toBe(false);
    expect(at(200)).toBe(false);
    expect(at(foldsAt - 1)).toBe(false);
  });

  it('collapses once the lanes have (almost) all scrolled under the header', () => {
    expect(at(foldsAt)).toBe(true);
    expect(at(440)).toBe(true);
    expect(at(900)).toBe(true);
  });

  it('expands again as soon as the lanes come back out from under the strip', () => {
    expect(at(900)).toBe(true);
    expect(at(foldsAt - 1)).toBe(false);
  });

  it('stays expanded until the lanes and the header have been measured', () => {
    expect(isAgentBoardCollapsed({ scrollY: 900, lanesBottom: null, headerBottom: 80 })).toBe(false);
    expect(isAgentBoardCollapsed({ scrollY: 900, lanesBottom: 520, headerBottom: null })).toBe(false);
  });

  it('never collapses an unscrolled board, however short its lanes', () => {
    expect(isAgentBoardCollapsed({ scrollY: 0, lanesBottom: 40, headerBottom: 80 })).toBe(false);
  });
});

describe('stripCell', () => {
  it(`shows up to ${STRIP_MAX_CHIPS} card chips, then +N`, () => {
    expect(stripCell(['1', '2'])).toEqual({ chips: ['1', '2'], overflow: 0, overflowLabel: null });
    expect(stripCell(['1', '2', '3'])).toEqual({ chips: ['1', '2', '3'], overflow: 0, overflowLabel: null });
    expect(stripCell(['1', '2', '3', '4', '5'])).toEqual({ chips: ['1', '2', '3'], overflow: 2, overflowLabel: '+2' });
  });

  it('is empty for an empty lane', () => {
    expect(stripCell([])).toEqual({ chips: [], overflow: 0, overflowLabel: null });
  });

  it('takes another limit', () => {
    expect(stripCell(['1', '2', '3'], 1)).toEqual({ chips: ['1'], overflow: 2, overflowLabel: '+2' });
  });
});

describe('stripChipLabel', () => {
  it("is the work item's #id for an ADO ticket, else the ticket's id", () => {
    expect(stripChipLabel({ id: '71273', ado: { workItemId: 71273 } })).toBe('#71273');
    expect(stripChipLabel({ id: 'local-7', ado: null })).toBe('local-7');
  });
});
