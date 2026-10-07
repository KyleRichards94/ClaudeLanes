import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { color, minTarget, selection } from '@agent-lanes/tokens';
import { SegmentedControl, stepIndex, type SegmentedControlProps, type SegmentedOption } from './SegmentedControl';

/** jsdom reports computed colours as rgb(); tokens are #RRGGBB. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const efforts: readonly SegmentedOption<Effort>[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
  { value: 'max', label: 'Max' },
];

type Source = 'sprint' | 'search' | 'none';

const sources: readonly SegmentedOption<Source>[] = [
  { value: 'sprint', label: 'Sprint 42' },
  { value: 'search', label: 'Search' },
  { value: 'none', label: 'No ticket' },
];

type HarnessProps<T extends string> = Omit<SegmentedControlProps<T>, 'value' | 'onChange'> & {
  initial: T;
  onChange?: (value: T) => void;
};

/** Holds the selection the way a screen would, so key presses can be followed across renders. */
function Harness<T extends string>({ initial, onChange, ...props }: HarnessProps<T>) {
  const [value, setValue] = useState(initial);
  return (
    <SegmentedControl
      {...props}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

const radio = (name: string) => screen.getByRole('radio', { name });

function checked(): string[] {
  return screen
    .getAllByRole('radio')
    .filter((element) => element.getAttribute('aria-checked') === 'true')
    .map((element) => element.textContent ?? '');
}

/** Which state the label is drawn in (jsdom has no layout, so read the computed style). */
function labelColour(name: string): string {
  return getComputedStyle(screen.getByText(name)).color;
}

describe('SegmentedControl', () => {
  it('is a named radiogroup of radios, one checked', () => {
    render(<SegmentedControl label="Effort" options={efforts} value="xhigh" onChange={() => {}} />);

    expect(screen.getByRole('radiogroup', { name: 'Effort' })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(radio('XHigh').getAttribute('aria-checked')).toBe('true');
    expect(checked()).toEqual(['XHigh']);
  });

  it('gives the group a single Tab stop, on the selected segment', () => {
    render(<SegmentedControl label="Effort" options={efforts} value="xhigh" onChange={() => {}} />);

    expect(radio('XHigh').getAttribute('tabindex')).toBe('0');
    for (const name of ['Low', 'Med', 'High', 'Max']) {
      expect(radio(name).getAttribute('tabindex')).toBe('-1');
    }
  });

  it('selects a segment when it is pressed', () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Effort" options={efforts} value="xhigh" onChange={onChange} />);

    fireEvent.click(radio('Med'));
    expect(onChange).toHaveBeenCalledWith('medium');

    onChange.mockClear();
    fireEvent.click(radio('XHigh'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves the selection and focus with the arrow keys, wrapping at the ends', () => {
    const onChange = vi.fn();
    render(<Harness label="Effort" options={efforts} initial="high" onChange={onChange} />);
    radio('High').focus();

    fireEvent.keyDown(radio('High'), { key: 'ArrowRight' });
    expect(checked()).toEqual(['XHigh']);
    expect(document.activeElement).toBe(radio('XHigh'));
    expect(onChange).toHaveBeenLastCalledWith('xhigh');

    fireEvent.keyDown(radio('XHigh'), { key: 'ArrowDown' });
    expect(checked()).toEqual(['Max']);

    fireEvent.keyDown(radio('Max'), { key: 'ArrowRight' });
    expect(checked()).toEqual(['Low']);
    expect(document.activeElement).toBe(radio('Low'));

    fireEvent.keyDown(radio('Low'), { key: 'ArrowLeft' });
    expect(checked()).toEqual(['Max']);

    fireEvent.keyDown(radio('Max'), { key: 'ArrowUp' });
    expect(checked()).toEqual(['XHigh']);
    expect(document.activeElement).toBe(radio('XHigh'));
    // The Tab stop follows the selection.
    expect(radio('XHigh').getAttribute('tabindex')).toBe('0');
    expect(radio('High').getAttribute('tabindex')).toBe('-1');
  });

  it('jumps to the first and last segment with Home and End', () => {
    render(<Harness label="Effort" options={efforts} initial="high" />);

    fireEvent.keyDown(radio('High'), { key: 'End' });
    expect(checked()).toEqual(['Max']);
    fireEvent.keyDown(radio('Max'), { key: 'Home' });
    expect(checked()).toEqual(['Low']);
  });

  it('keeps arrow keys and Space from scrolling the page', () => {
    render(<Harness label="Effort" options={efforts} initial="high" />);

    // fireEvent returns false when the handler called preventDefault.
    expect(fireEvent.keyDown(radio('High'), { key: 'ArrowRight' })).toBe(false);
    expect(fireEvent.keyDown(radio('XHigh'), { key: ' ' })).toBe(false);
    expect(fireEvent.keyDown(radio('XHigh'), { key: 'a' })).toBe(true);
  });

  it('checks the focused segment with Space', () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Effort" options={efforts} value="xhigh" onChange={onChange} />);

    fireEvent.keyDown(radio('Low'), { key: ' ' });
    expect(onChange).toHaveBeenCalledWith('low');
  });

  it('skips disabled segments and ignores presses on them', () => {
    const onChange = vi.fn();
    const options = efforts.map((option) => (option.value === 'high' ? { ...option, disabled: true } : option));
    render(<Harness label="Effort" options={options} initial="medium" onChange={onChange} />);

    expect(radio('High').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(radio('High'));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(radio('Med'), { key: 'ArrowRight' });
    expect(checked()).toEqual(['XHigh']);
    fireEvent.keyDown(radio('XHigh'), { key: 'ArrowLeft' });
    expect(checked()).toEqual(['Med']);
  });

  it('takes no focus and no input when the whole control is disabled', () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Effort" options={efforts} value="xhigh" onChange={onChange} disabled />);

    expect(screen.getByRole('radiogroup').getAttribute('aria-disabled')).toBe('true');
    for (const element of screen.getAllByRole('radio')) {
      expect(element.getAttribute('tabindex')).toBe('-1');
      expect(element.getAttribute('aria-disabled')).toBe('true');
    }
    fireEvent.click(radio('Low'));
    fireEvent.keyDown(radio('XHigh'), { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('puts the Tab stop on the first usable segment when the value is not one of them', () => {
    const options = efforts.map((option) => (option.value === 'low' ? { ...option, disabled: true } : option));
    render(<SegmentedControl label="Effort" options={options} value="low" onChange={() => {}} />);

    expect(radio('Med').getAttribute('tabindex')).toBe('0');
    expect(radio('Low').getAttribute('tabindex')).toBe('-1');
  });

  it('names an abbreviated segment with its accessibility label', () => {
    const options = efforts.map((option) =>
      option.value === 'medium' ? { ...option, accessibilityLabel: 'Medium effort' } : option,
    );
    render(<SegmentedControl label="Effort" options={options} value="medium" onChange={() => {}} />);

    expect(radio('Medium effort').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Med')).toBeTruthy();
  });

  it('makes every segment a 44 px target', () => {
    render(<SegmentedControl label="Effort" options={efforts} value="xhigh" onChange={() => {}} />);
    for (const element of screen.getAllByRole('radio')) {
      expect(getComputedStyle(element).minHeight).toBe(`${minTarget}px`);
    }
  });

  describe('looks (artboards 2 and 3)', () => {
    it('draws the selected segment as a white thumb with violet text on the grey track', () => {
      render(<SegmentedControl testID="effort" label="Effort" options={efforts} value="xhigh" onChange={() => {}} fill />);

      expect(getComputedStyle(screen.getByTestId('effort')).backgroundColor).toBe(rgb(selection.track));
      expect(getComputedStyle(screen.getByTestId('effort-xhigh-thumb')).backgroundColor).toBe(rgb(color.surface));
      expect(labelColour('XHigh')).toBe(rgb(color.claudeText));
      expect(getComputedStyle(screen.getByText('XHigh')).fontWeight).toBe('700');

      // Unselected segments show the track through and use the slate label colour.
      expect(getComputedStyle(screen.getByTestId('effort-low-thumb')).backgroundColor).not.toBe(rgb(color.surface));
      expect(labelColour('Low')).toBe(rgb(selection.label));
      // Same weight in both states, so selecting never reflows the neighbours.
      expect(getComputedStyle(screen.getByText('Low')).fontWeight).toBe('700');
    });

    it('uses ink for the selected label where the artboard does (Sprint 42 / Search / No ticket)', () => {
      render(<SegmentedControl label="Work item" options={sources} value="sprint" tone="ink" onChange={() => {}} />);

      expect(labelColour('Sprint 42')).toBe(rgb(color.ink));
      expect(labelColour('Search')).toBe(rgb(selection.label));
    });

    it('stretches equal segments with `fill` and hugs the labels without it', () => {
      const { rerender } = render(
        <SegmentedControl testID="seg" label="Work item" options={sources} value="sprint" onChange={() => {}} />,
      );
      expect(getComputedStyle(screen.getByTestId('seg')).alignSelf).toBe('flex-start');
      expect(getComputedStyle(radio('Search')).flexGrow).not.toBe('1');

      rerender(<SegmentedControl testID="seg" label="Work item" options={sources} value="sprint" onChange={() => {}} fill />);
      expect(getComputedStyle(screen.getByTestId('seg')).alignSelf).not.toBe('flex-start');
      expect(getComputedStyle(radio('Search')).flexGrow).toBe('1');
    });

    it('draws the pills variant with the selected pill filled violet and white text', () => {
      render(
        <SegmentedControl testID="pills" label="Effort" variant="pills" options={efforts} value="xhigh" onChange={() => {}} fill />,
      );

      const selected = getComputedStyle(screen.getByTestId('pills-xhigh-thumb'));
      expect(selected.backgroundColor).toBe(rgb(color.claude));
      expect(labelColour('XHigh')).toBe(rgb(color.surface));

      const other = getComputedStyle(screen.getByTestId('pills-low-thumb'));
      expect(other.backgroundColor).toBe(rgb(color.surface));
      expect(other.borderTopColor).toBe(rgb(color.line));
      expect(labelColour('Low')).toBe(rgb(selection.label));
      expect(getComputedStyle(screen.getByText('Low')).fontWeight).toBe('500');
      expect(getComputedStyle(screen.getByText('XHigh')).fontWeight).toBe('700');
      // The radios are the same 44 px targets as the track variant.
      expect(getComputedStyle(radio('Low')).minHeight).toBe(`${minTarget}px`);
    });
  });
});

describe('stepIndex', () => {
  const all = [true, true, true];

  it('wraps forwards and backwards', () => {
    expect(stepIndex(all, 2, 'next')).toBe(0);
    expect(stepIndex(all, 0, 'previous')).toBe(2);
  });

  it('skips disabled entries, including for first and last', () => {
    const some = [false, true, false, true, false];
    expect(stepIndex(some, 1, 'next')).toBe(3);
    expect(stepIndex(some, 3, 'next')).toBe(1);
    expect(stepIndex(some, 0, 'first')).toBe(1);
    expect(stepIndex(some, 0, 'last')).toBe(3);
  });

  it('returns -1 when nothing is enabled', () => {
    expect(stepIndex([false, false], 0, 'next')).toBe(-1);
    expect(stepIndex([false, false], 0, 'first')).toBe(-1);
  });
});
