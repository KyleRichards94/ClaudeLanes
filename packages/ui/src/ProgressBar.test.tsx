import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { color, progressGradient, tone } from '@agent-lanes/tokens';
import { ProgressBar, toPercent, type ProgressTone } from './ProgressBar';

function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

describe('ProgressBar', () => {
  it('is announced as a progressbar with its name and value', () => {
    render(<ProgressBar progress={0.42} label="Implementing progress" />);
    const bar = screen.getByRole('progressbar', { name: 'Implementing progress' });
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
  });

  it('fills the track to the progress', () => {
    render(<ProgressBar testID="bar" progress={0.75} label="Progress" />);
    expect(getComputedStyle(screen.getByTestId('bar-fill')).width).toBe('75%');
    const track = getComputedStyle(screen.getByTestId('bar'));
    expect(track.backgroundColor).toBe(rgb(color.line));
    expect(track.height).toBe('6px');
  });

  it.each([
    [-0.5, 0],
    [0, 0],
    [0.333, 33],
    [1, 100],
    [1.7, 100],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ])('clamps %s to %s %%', (progress, percent) => {
    expect(toPercent(progress)).toBe(percent);
  });

  it('runs violet to sky by default', () => {
    render(<ProgressBar testID="bar" progress={0.5} label="Progress" />);
    const fill = getComputedStyle(screen.getByTestId('bar-fill'));
    expect(fill.backgroundImage).toBe(
      `linear-gradient(90deg, ${rgb(progressGradient.from)}, ${rgb(progressGradient.to)})`,
    );
  });

  const solid: [ProgressTone, string][] = [
    ['ok', tone.ok.fill],
    ['ado', tone.ado.fill],
    ['danger', tone.danger.fill],
  ];

  it.each(solid)('%s tone is a solid fill', (fillTone, fill) => {
    render(<ProgressBar testID="bar" progress={1} tone={fillTone} label="Progress" />);
    const style = getComputedStyle(screen.getByTestId('bar-fill'));
    expect(style.backgroundColor).toBe(rgb(fill));
    expect(style.backgroundImage === '' || style.backgroundImage === 'none').toBe(true);
  });
});
