import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { color, minTarget, selection } from '@agent-lanes/tokens';
import { Switch, type SwitchProps } from './Switch';

/** jsdom reports computed colours as rgb(); tokens are #RRGGBB. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

const gate = { on: 'Needs approval', off: 'Auto' };

type HarnessProps = Omit<SwitchProps, 'value' | 'onValueChange'> & {
  initial: boolean;
  onValueChange?: (value: boolean) => void;
};

/** Holds the value the way the stage-gates list would. */
function Harness({ initial, onValueChange, ...props }: HarnessProps) {
  const [value, setValue] = useState(initial);
  return (
    <Switch
      {...props}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValueChange?.(next);
      }}
    />
  );
}

const theSwitch = () => screen.getByRole('switch');

describe('Switch', () => {
  it('is a switch named by its label and state text, exposing aria-checked', () => {
    render(<Switch label="Planning" value stateText={gate} onValueChange={() => {}} />);

    const element = screen.getByRole('switch', { name: 'Planning Needs approval' });
    expect(element.getAttribute('role')).toBe('switch');
    expect(element.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Needs approval')).toBeTruthy();
  });

  it('is named by the label alone without state text', () => {
    render(<Switch label="Post stage comments" value={false} onValueChange={() => {}} />);
    expect(screen.getByRole('switch', { name: 'Post stage comments' }).getAttribute('aria-checked')).toBe('false');
  });

  it('toggles with Space and keeps the page from scrolling', () => {
    const onValueChange = vi.fn();
    render(<Harness label="Implementing" initial={false} stateText={gate} onValueChange={onValueChange} />);
    expect(theSwitch().getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Auto')).toBeTruthy();

    // fireEvent returns false when the handler called preventDefault.
    expect(fireEvent.keyDown(theSwitch(), { key: ' ' })).toBe(false);
    expect(onValueChange).toHaveBeenLastCalledWith(true);
    expect(theSwitch().getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Needs approval')).toBeTruthy();
    expect(screen.queryByText('Auto')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Implementing Needs approval' })).toBeTruthy();

    fireEvent.keyDown(theSwitch(), { key: ' ' });
    expect(onValueChange).toHaveBeenLastCalledWith(false);
    expect(theSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('does not flicker while Space is held down', () => {
    const onValueChange = vi.fn();
    render(<Harness label="QA" initial={false} onValueChange={onValueChange} />);

    fireEvent.keyDown(theSwitch(), { key: ' ' });
    fireEvent.keyDown(theSwitch(), { key: ' ', repeat: true });
    fireEvent.keyDown(theSwitch(), { key: ' ', repeat: true });
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(theSwitch().getAttribute('aria-checked')).toBe('true');
  });

  it('toggles with a click and with Enter', () => {
    render(<Harness label="Code review" initial={false} />);

    fireEvent.click(theSwitch());
    expect(theSwitch().getAttribute('aria-checked')).toBe('true');

    fireEvent.keyDown(theSwitch(), { key: 'Enter' });
    fireEvent.keyUp(theSwitch(), { key: 'Enter' });
    expect(theSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('ignores other keys', () => {
    const onValueChange = vi.fn();
    render(<Switch label="QA" value={false} onValueChange={onValueChange} />);

    expect(fireEvent.keyDown(theSwitch(), { key: 'a' })).toBe(true);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('is announced as disabled, leaves the Tab order and ignores input when disabled', () => {
    const onValueChange = vi.fn();
    render(<Switch label="Create PR" value stateText={gate} onValueChange={onValueChange} disabled />);

    expect(theSwitch().getAttribute('aria-disabled')).toBe('true');
    expect(theSwitch().getAttribute('tabindex')).toBe('-1');
    fireEvent.click(theSwitch());
    fireEvent.keyDown(theSwitch(), { key: ' ' });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('is focusable and at least a 44 px target', () => {
    render(<Switch label="Planning" value onValueChange={() => {}} />);

    expect(theSwitch().getAttribute('tabindex')).toBe('0');
    expect(parseFloat(getComputedStyle(theSwitch()).minHeight)).toBeGreaterThanOrEqual(minTarget);
  });

  describe('looks (artboard 2 stage gates)', () => {
    it('shows a violet track with the knob to the right when on', () => {
      render(<Switch testID="gate" label="Planning" value stateText={gate} onValueChange={() => {}} />);

      expect(getComputedStyle(screen.getByTestId('gate-track')).backgroundColor).toBe(rgb(color.claude));
      expect(getComputedStyle(screen.getByTestId('gate-knob')).transform).toBe('translateX(16px)');
      expect(getComputedStyle(screen.getByTestId('gate-knob')).backgroundColor).toBe(rgb(color.surface));
      expect(getComputedStyle(screen.getByText('Needs approval')).color).toBe(rgb(selection.label));
      expect(getComputedStyle(screen.getByText('Planning')).color).toBe(rgb(color.ink));
    });

    it('shows a grey track with the knob to the left when off', () => {
      render(<Switch testID="gate" label="Implementing" value={false} stateText={gate} onValueChange={() => {}} />);

      expect(getComputedStyle(screen.getByTestId('gate-track')).backgroundColor).toBe(rgb(selection.switchOff));
      expect(getComputedStyle(screen.getByTestId('gate-knob')).transform).not.toContain('translateX(16px)');
    });
  });
});
