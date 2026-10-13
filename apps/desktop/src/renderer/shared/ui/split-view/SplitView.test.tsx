import { fireEvent, render, screen } from '@testing-library/react';
import { Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { SPLIT_KEY_STEP, SplitView, clampRatio } from './SplitView';

describe('SplitView', () => {
  it('is a separator the arrow keys move, within the smallest share each pane keeps', () => {
    const onRatioChange = vi.fn();
    render(<SplitView direction="row" ratio={0.5} onRatioChange={onRatioChange} label="Resize the output and the diff" first={<Text>Output</Text>} second={<Text>Diff</Text>} />);
    const divider = screen.getByRole('separator', { name: 'Resize the output and the diff' });
    expect(divider.getAttribute('aria-valuenow')).toBe('50');
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(onRatioChange).toHaveBeenLastCalledWith(0.5 + SPLIT_KEY_STEP);
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(onRatioChange).toHaveBeenLastCalledWith(0.5 - SPLIT_KEY_STEP);
    expect(clampRatio(0.95, 0.2)).toBe(0.8);
    expect(clampRatio(0.05, 0.2)).toBe(0.2);
  });

  it('shows the first pane alone, with no divider, when there is no second', () => {
    render(<SplitView direction="column" ratio={0.5} onRatioChange={() => undefined} label="Resize" first={<Text>Output</Text>} second={null} />);
    expect(screen.getByText('Output')).toBeTruthy();
    expect(screen.queryByRole('separator')).toBeNull();
  });
});
