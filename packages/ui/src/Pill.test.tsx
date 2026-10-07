import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { font, fontSize, fontWeight, radius, tone } from '@agent-lanes/tokens';
import { Pill, pillTones, type PillSize } from './Pill';

/** jsdom reports computed colours as rgb(); tokens are #RRGGBB. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Box and type for each size; height = 2 × vertical padding + line height (jsdom does no layout). */
const sizes: Record<PillSize, { height: number; padX: number; padY: number; fontSize: number; weight: string }> = {
  sm: { height: 22, padX: 8, padY: 3, fontSize: fontSize.sm, weight: fontWeight.heading },
  md: { height: 28, padX: 10, padY: 4, fontSize: fontSize.md, weight: fontWeight.body },
};

describe('Pill', () => {
  it('has the six tones from the ticket', () => {
    expect([...pillTones]).toEqual(['claude', 'ado', 'ok', 'attention', 'danger', 'neutral']);
  });

  it.each(pillTones)('%s sets its label in the tone text on the tone band', (pillTone) => {
    render(<Pill testID="pill" tone={pillTone} label="Running" />);
    const pill = screen.getByTestId('pill');
    expect(getComputedStyle(pill).backgroundColor).toBe(rgb(tone[pillTone].band));
    expect(getComputedStyle(pill).borderTopLeftRadius).toBe(`${radius.pill}px`);
    expect(getComputedStyle(screen.getByText('Running')).color).toBe(rgb(tone[pillTone].text));
  });

  it('is neutral and small with no dot by default', () => {
    render(<Pill testID="pill" label="1 queued" />);
    expect(getComputedStyle(screen.getByTestId('pill')).backgroundColor).toBe(rgb(tone.neutral.band));
    expect(getComputedStyle(screen.getByText('1 queued')).fontSize).toBe(`${fontSize.sm}px`);
    expect(screen.queryByTestId('pill-dot')).toBeNull();
  });

  it.each(pillTones)('%s dot is a 6 px circle in the tone dot colour, hidden from screen readers', (pillTone) => {
    render(<Pill testID="pill" tone={pillTone} dot label="MCP online" />);
    const dot = screen.getByTestId('pill-dot');
    const style = getComputedStyle(dot);
    expect(style.backgroundColor).toBe(rgb(tone[pillTone].dot));
    expect(style.width).toBe('6px');
    expect(style.height).toBe('6px');
    expect(style.borderTopLeftRadius).toBe('3px');
    expect(style.marginRight).toBe('6px');
    expect(dot.getAttribute('aria-hidden')).toBe('true');
    // The dot comes first, then the word.
    expect(screen.getByTestId('pill').firstElementChild).toBe(dot);
  });

  it.each(Object.entries(sizes))('%s size has the artboard box and type', (size, want) => {
    render(<Pill testID="pill" size={size as PillSize} label="4 running" />);
    const box = getComputedStyle(screen.getByTestId('pill'));
    const label = getComputedStyle(screen.getByText('4 running'));

    expect(box.paddingLeft).toBe(`${want.padX}px`);
    expect(box.paddingRight).toBe(`${want.padX}px`);
    expect(box.paddingTop).toBe(`${want.padY}px`);
    expect(box.paddingBottom).toBe(`${want.padY}px`);
    expect(label.fontFamily).toBe(font.sans);
    expect(label.fontSize).toBe(`${want.fontSize}px`);
    expect(label.fontWeight).toBe(want.weight);
    expect(want.padY * 2 + parseFloat(label.lineHeight)).toBe(want.height);
  });

  it('lays out the dot and label in a row that hugs its content and does not shrink', () => {
    render(<Pill testID="pill" dot label="Needs you" />);
    const style = getComputedStyle(screen.getByTestId('pill'));
    expect(style.flexDirection).toBe('row');
    expect(style.alignItems).toBe('center');
    expect(style.alignSelf).toBe('flex-start');
    expect(style.flexShrink).toBe('0');
  });

  it('keeps the label on one line', () => {
    render(<Pill label="Switching · next turn" />);
    expect(getComputedStyle(screen.getByText('Switching · next turn')).whiteSpace).toBe('nowrap');
  });

  it('reads as its word alone: the dot adds no text', () => {
    render(<Pill testID="pill" tone="ok" dot label="Done" />);
    expect(screen.getByTestId('pill').textContent).toBe('Done');
  });

  it('requires a label, so no pill can be colour only', () => {
    // @ts-expect-error `label` is required.
    const pill = <Pill tone="danger" dot />;
    expect(pill.props).not.toHaveProperty('label');
  });

  it('accepts layout style from the caller', () => {
    render(<Pill testID="pill" label="Ready" tone="ado" style={{ marginLeft: 12 }} />);
    expect(getComputedStyle(screen.getByTestId('pill')).marginLeft).toBe('12px');
  });
});
