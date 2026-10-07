import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adoFixture } from '@agent-lanes/contracts/testing';
import { filterWorkItems, pickedWorkItem, useDebouncedValue } from './work-item-picker';

const items = adoFixture().workItems.slice(0, 4);

afterEach(() => vi.useRealTimers());

describe('work item picker model (AL-161)', () => {
  it('filters the sprint by id prefix or title text', () => {
    expect(filterWorkItems(items, '').map((item) => item.id)).toEqual([71273, 71330, 71335, 71341]);
    expect(filterWorkItems(items, '#7133').map((item) => item.id)).toEqual([71330, 71335]);
    expect(filterWorkItems(items, '71273').map((item) => item.id)).toEqual([71273]);
    expect(filterWorkItems(items, '  BLAZOR ').map((item) => item.id)).toEqual([71273]);
    expect(filterWorkItems(items, 'nothing like this')).toEqual([]);
  });

  it('keeps only what the form needs from a row', () => {
    const [item] = items;
    if (!item) throw new Error('fixture');
    expect(pickedWorkItem(item)).toEqual({ id: 71273, title: 'Cutover frmJobControl to Blazor', type: 'User Story', state: 'Active' });
  });

  it('settles a value once it stops changing', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), { initialProps: { value: 'a' } });
    rerender({ value: 'ab' });
    act(() => vi.advanceTimersByTime(200));
    rerender({ value: 'abc' });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe('a');
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe('abc');
  });
});
