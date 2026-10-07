import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { adoFixture } from '@agent-lanes/contracts/testing';
import { sprintNameOf, stateCategoryTone, workItemSummary, workItemTypeLabel } from '../model/work-item';
import { WorkItemChip } from './WorkItemChip';

const [item] = adoFixture().workItems;

describe('ado-work-item entity (AL-066)', () => {
  it('words a work item the way the artboards do', () => {
    expect(workItemTypeLabel('User Story')).toBe('Story');
    expect(workItemTypeLabel('Bug')).toBe('Bug');
    expect(workItemSummary({ type: 'User Story', state: 'Active' })).toBe('Story · Active');
    expect(sprintNameOf('OnSite Companion\\Sprint 42')).toBe('Sprint 42');
  });

  it('colours a state by its category', () => {
    expect(stateCategoryTone('in-progress')).toBe('ado');
    expect(stateCategoryTone('completed')).toBe('ok');
    expect(stateCategoryTone('resolved')).toBe('ok');
    expect(stateCategoryTone('proposed')).toBe('neutral');
    expect(stateCategoryTone('unknown')).toBe('neutral');
  });

  it('shows the id chip, the title and the state in words', () => {
    if (!item) throw new Error('fixture has no work items');
    render(<WorkItemChip item={item} testID="chip" />);
    expect(screen.getByText(`#${item.id}`)).toBeTruthy();
    expect(screen.getByText(item.title)).toBeTruthy();
    expect(screen.getByText(workItemSummary(item))).toBeTruthy();
    expect(screen.getByRole('group', { name: `Work item ${item.id}, ${item.title}, ${workItemSummary(item)}` })).toBeTruthy();
  });

  it('can leave the title out', () => {
    if (!item) throw new Error('fixture has no work items');
    render(<WorkItemChip item={item} showTitle={false} />);
    expect(screen.queryByText(item.title)).toBeNull();
  });
});
