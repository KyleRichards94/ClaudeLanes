import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { font, fontWeight, radius, tone } from '@agent-lanes/tokens';
import { IdChip } from './IdChip';

/** jsdom reports computed colours as rgb(); tokens are #RRGGBB. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

describe('IdChip', () => {
  it('shows the work item id as #71273 in mono on the ADO tint', () => {
    render(<IdChip testID="chip" id={71273} />);
    const chip = getComputedStyle(screen.getByTestId('chip'));
    const id = getComputedStyle(screen.getByText('#71273'));

    expect(chip.backgroundColor).toBe(rgb(tone.ado.band));
    expect(chip.borderTopLeftRadius).toBe(`${radius.chip}px`);
    expect(id.color).toBe(rgb(tone.ado.text));
    expect(id.fontFamily).toBe(font.mono);
    expect(id.fontWeight).toBe(fontWeight.mono);
    expect(id.fontSize).toBe('11px');
  });

  it('is 19 px tall with 6 px sides, as on the card headers of artboards 1 and 6', () => {
    render(<IdChip testID="chip" id={71330} />);
    const chip = getComputedStyle(screen.getByTestId('chip'));
    const id = getComputedStyle(screen.getByText('#71330'));
    expect(chip.paddingLeft).toBe('6px');
    expect(chip.paddingRight).toBe('6px');
    expect(parseFloat(chip.paddingTop) + parseFloat(id.lineHeight) + parseFloat(chip.paddingBottom)).toBe(19);
    expect(chip.alignSelf).toBe('flex-start');
  });

  it.each([
    ['71273', '#71273'],
    ['#71273', '#71273'],
    [' 71273 ', '#71273'],
  ])('takes the string id %j and shows %s', (id, shown) => {
    render(<IdChip testID="chip" id={id} />);
    expect(screen.getByTestId('chip').textContent).toBe(shown);
  });
});
