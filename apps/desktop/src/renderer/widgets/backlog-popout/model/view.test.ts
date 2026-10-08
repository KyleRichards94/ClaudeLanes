import { describe, expect, it } from 'vitest';
import { activeDrag } from '@/features/drag-to-lane';
import { KR, MD, artboard11Page, backlogItem } from './fixtures';
import { DEFAULT_BACKLOG_SEARCH } from './session';
import { areaLabel, backlogFilters, backlogGroups, clickSelection, filterChoices, rowDrag, rowOrder, rowView } from './view';

const ME = { displayName: 'Kyle Richards' };

describe('backlogFilters (AL-239 → AL-233)', () => {
  it('sends nothing for no filters', () => {
    expect(backlogFilters(DEFAULT_BACKLOG_SEARCH)).toEqual({});
  });

  it('sends every filter set, and trims the search', () => {
    expect(backlogFilters({ text: '  reassign ', kind: 'bug', priority: 1, area: 'OnSite Companion\\OSC\\Portal', tag: 'portal', includeInSprint: true })).toEqual({
      text: 'reassign',
      kinds: ['bug'],
      priorities: [1],
      areas: ['OnSite Companion\\OSC\\Portal'],
      tags: ['portal'],
      includeInSprint: true,
    });
  });
});

describe('backlogGroups (artboard 11)', () => {
  it('groups the rows by Feature in backlog order, with what each row shows', () => {
    const groups = backlogGroups([artboard11Page()], ME, {});
    expect(groups.map((group) => [group.title, group.rows.length])).toEqual([
      ['Job management', 3],
      ['Client portal', 3],
      ['Timesheets', 1],
    ]);
    expect(rowOrder(groups)).toEqual([71360, 71362, 71371, 71335, 71377, 71380, 71384]);
    expect(groups[0]!.rows[0]).toMatchObject({ idLabel: '#71360', type: 'Story', typeTone: 'ado', tag: 'jobs', points: '5 pts', priority: 1, lock: null, agentTag: null });
    expect(groups[0]!.rows[1]).toMatchObject({ type: 'Bug', typeTone: 'danger' });
    expect(groups[2]!.rows[0]).toMatchObject({ type: 'Task', typeTone: 'neutral', tag: 'payroll' });
  });

  it('joins a Feature that runs over a page boundary (D600)', () => {
    const first = artboard11Page({ page: { index: 0, size: 3, count: 3 }, groups: [artboard11Page().groups[0]!] });
    const second = artboard11Page({
      page: { index: 1, size: 3, count: 3 },
      groups: [{ feature: { id: 70101, title: 'Job management' }, items: [backlogItem(71400)] }, { feature: null, items: [backlogItem(71401)] }],
    });
    const groups = backlogGroups([first, second], ME, {});
    expect(groups.map((group) => [group.title, group.rows.length])).toEqual([
      ['Job management', 4],
      ['No feature', 1],
    ]);
  });

  it("locks someone else's row, keeps yours and unassigned ones draggable, and tags a row an agent has", () => {
    const theirs = rowView(backlogItem(1, { assignee: MD }), ME, null);
    expect(theirs).toMatchObject({ lock: 'Assigned to Mark Davies', drag: null });
    const mine = rowView(backlogItem(2, { assignee: KR }), ME, null);
    expect(mine.lock).toBeNull();
    expect(mine.drag).toMatchObject({ key: 'backlog:2', source: { kind: 'backlog-item', id: 2 } });
    expect(Object.keys(activeDrag(mine.drag!, 'pointer').allowed)).toEqual(['planning', 'implementing']);
    const taken = rowView(backlogItem(3), ME, 'planning');
    expect(taken).toMatchObject({ agentTag: 'Agent in Planning', lock: null, drag: null });
  });
});

describe('selection (TB§5 multi-select)', () => {
  const order = [1, 2, 3, 4, 5];

  it('adds and removes a row on a plain click, keeping list order', () => {
    expect(clickSelection({ selected: [], order, anchor: null, id: 3, shift: false })).toEqual([3]);
    expect(clickSelection({ selected: [3], order, anchor: 3, id: 1, shift: false })).toEqual([1, 3]);
    expect(clickSelection({ selected: [1, 3], order, anchor: 1, id: 3, shift: false })).toEqual([1]);
  });

  it('adds every row from the last one clicked on a shift-click, either way', () => {
    expect(clickSelection({ selected: [2], order, anchor: 2, id: 4, shift: true })).toEqual([2, 3, 4]);
    expect(clickSelection({ selected: [5], order, anchor: 5, id: 3, shift: true })).toEqual([3, 4, 5]);
    // No row clicked yet: a shift-click selects just that row.
    expect(clickSelection({ selected: [], order, anchor: null, id: 4, shift: true })).toEqual([4]);
  });

  it('drags every selected row from any one of them, and only itself from an unselected row', () => {
    const rows = artboard11Page().groups[0]!.items.map((item) => rowView(item, ME, null));
    const selected = [rows[0]!, rows[2]!];
    expect(rowDrag(rows[2]!, selected)?.group?.map((member) => member.key)).toEqual(['backlog:71360', 'backlog:71371']);
    expect(rowDrag(rows[1]!, selected)?.group).toBeUndefined();
    expect(rowDrag(rows[0]!, [rows[0]!])?.group).toBeUndefined();
  });
});

describe('filter choices', () => {
  it('lists the areas and tags on the loaded rows, and names an area by its last level', () => {
    expect(filterChoices([artboard11Page()])).toEqual({
      areas: ['OnSite Companion\\OSC', 'OnSite Companion\\OSC\\Portal'],
      tags: ['jobs', 'payroll', 'portal', 'quotes', 'search'],
    });
    expect(areaLabel('OnSite Companion\\OSC\\Portal')).toBe('Portal');
  });
});
