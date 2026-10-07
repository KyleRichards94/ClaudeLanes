import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { color, radius, tone } from '@agent-lanes/tokens';
import { Badge } from './Badge';

/** jsdom reports computed colours as rgb(); tokens are #RRGGBB. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

describe('Badge', () => {
  it('is a white 40 × 24 lane count with the slate number, as on artboard 1', () => {
    render(<Badge testID="badge" count={1} />);
    const box = getComputedStyle(screen.getByTestId('badge'));
    const number = getComputedStyle(screen.getByText('1'));

    expect(box.backgroundColor).toBe(rgb(color.surface));
    expect(box.borderTopLeftRadius).toBe(`${radius.pill}px`);
    expect(box.minWidth).toBe('40px');
    expect(parseFloat(box.paddingTop) + parseFloat(number.lineHeight) + parseFloat(box.paddingBottom)).toBe(24);
    expect(box.alignItems).toBe('center');
    expect(box.justifyContent).toBe('center');
    expect(number.color).toBe(rgb(tone.neutral.text));
    expect(number.fontSize).toBe('12px');
    expect(number.fontWeight).toBe('700');
  });

  it('has an amber variant for a lane with a card that needs the user', () => {
    render(<Badge testID="badge" count={1} tone="attention" />);
    expect(getComputedStyle(screen.getByTestId('badge')).backgroundColor).toBe(rgb(tone.attention.band));
    expect(getComputedStyle(screen.getByText('1')).color).toBe(rgb(tone.attention.text));
  });

  it('is named by its count', () => {
    render(<Badge count={2} />);
    expect(screen.getByRole('img', { name: '2' })).toBeTruthy();
  });

  it('says "needs you" in the amber variant, so the colour is never the only signal', () => {
    render(<Badge count={1} tone="attention" />);
    expect(screen.getByRole('img', { name: '1, needs you' })).toBeTruthy();
  });

  it('takes a fuller accessible name from the lane', () => {
    render(<Badge count={3} tone="attention" label="3 tickets, 1 needs you" />);
    expect(screen.getByRole('img', { name: '3 tickets, 1 needs you' })).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it.each([
    [12, '12'],
    [2.7, '2'],
    [-1, '0'],
    [Number.NaN, '0'],
    [Number.POSITIVE_INFINITY, '0'],
  ])('shows %s as %s', (count, shown) => {
    render(<Badge testID="badge" count={count} />);
    expect(screen.getByTestId('badge').textContent).toBe(shown);
  });
});
