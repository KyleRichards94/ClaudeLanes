import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { outputDiffLayout, setOutputDiffLayout } from './ticket-tabs';
import {
  clearSelection,
  getTicketView,
  resetTicketViews,
  selectFile,
  selectTurn,
  setDiffMode,
  setFollowAgent,
  useDiffMode,
  useFollowAgent,
  useSelectedFilePath,
  useTicketView,
} from './ticket-view';

describe('the ticket view store (AL-275)', () => {
  beforeEach(() => resetTicketViews());

  it('starts with nothing selected, following the agent, unified', () => {
    expect(getTicketView('71273')).toEqual({ selectedFilePath: null, selectedTurn: null, followAgent: true, diffMode: 'unified' });
  });

  it('keeps a selected file and turn per ticket, and Esc clears the file only', () => {
    selectFile('71273', 'src/Grid.razor');
    selectTurn('71273', 3);
    selectFile('71330', 'src/Other.cs');

    expect(getTicketView('71273')).toMatchObject({ selectedFilePath: 'src/Grid.razor', selectedTurn: 3 });
    expect(getTicketView('71330')).toMatchObject({ selectedFilePath: 'src/Other.cs', selectedTurn: null });

    clearSelection('71273');
    expect(getTicketView('71273')).toMatchObject({ selectedFilePath: null, selectedTurn: 3 });
    selectTurn('71273', null);
    expect(getTicketView('71273').selectedTurn).toBeNull();
  });

  it('shares Follow agent and the diff mode with the Output & diff view, both ways', () => {
    setFollowAgent('71273', false);
    setDiffMode('71273', 'split');
    expect(outputDiffLayout()).toMatchObject({ follow: false, diffView: 'split' });

    // The Output & diff layout's own writes show up in the view too.
    setOutputDiffLayout({ follow: true, diffView: 'unified' });
    expect(getTicketView('71273')).toMatchObject({ followAgent: true, diffMode: 'unified' });
  });

  it('gives a component the fields it reads and does not re-render it for an unchanged selection', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return { path: useSelectedFilePath('71273'), follow: useFollowAgent('71273'), mode: useDiffMode('71273') };
    });
    expect(result.current).toEqual({ path: null, follow: true, mode: 'unified' });

    act(() => selectFile('71273', 'a.cs'));
    expect(result.current.path).toBe('a.cs');
    act(() => setDiffMode('71273', 'split'));
    expect(result.current.mode).toBe('split');

    const before = renders;
    act(() => selectFile('71273', 'a.cs'));
    expect(renders).toBe(before);
  });

  it('reads through a selector', () => {
    const { result } = renderHook(() => useTicketView('71273', (view) => view.selectedTurn));
    act(() => selectTurn('71273', 2));
    expect(result.current).toBe(2);
  });
});
