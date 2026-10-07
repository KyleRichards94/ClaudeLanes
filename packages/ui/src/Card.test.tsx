import { render, screen } from '@testing-library/react';
import { Text } from 'react-native';
import { describe, expect, it } from 'vitest';
import { color, mutedOpacity, radius, shadow, tone } from '@agent-lanes/tokens';
import { Card, CardSection, type CardFooterTone, type CardSectionTone, type CardTone } from './Card';

/** jsdom reports computed colours as rgb(); tokens are #RRGGBB. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

const borderFor: Record<CardTone, string> = {
  default: color.line,
  selected: tone.claude.border,
  attention: tone.attention.border,
  danger: tone.danger.border,
  muted: color.line,
};

const footerFor: Record<CardFooterTone, { band: string; text: string }> = {
  attention: tone.attention,
  ado: tone.ado,
  danger: tone.danger,
  ok: tone.ok,
};

/** Every card on the "Agent card states" artboard (docs/design/screens/06-card-states.png). */
const artboard6: { state: string; tone: CardTone; footer?: { tone: CardFooterTone; label: string } }[] = [
  { state: 'Running', tone: 'default' },
  { state: 'Selected', tone: 'selected' },
  { state: 'Needs approval', tone: 'attention', footer: { tone: 'attention', label: 'Needs you · approve plan' } },
  { state: 'Model switching', tone: 'default', footer: { tone: 'ado', label: 'Switching · applies next turn' } },
  { state: 'Build failed', tone: 'danger', footer: { tone: 'danger', label: 'Build failed · 3 errors' } },
  { state: 'QA gap', tone: 'attention', footer: { tone: 'attention', label: 'Needs you · 1 gap' } },
  { state: 'PR open', tone: 'default' },
  { state: 'Merged', tone: 'muted' },
];

function expectOutline(element: HTMLElement, cardTone: CardTone) {
  const style = getComputedStyle(element);
  expect(style.borderTopColor).toBe(rgb(borderFor[cardTone]));
  expect(style.borderTopWidth).toBe('1px');
  expect(style.opacity).toBe(cardTone === 'muted' ? String(mutedOpacity) : '1');
}

function expectFooter(cardTestId: string, footerTone: CardFooterTone, label: string) {
  const band = screen.getByTestId(`${cardTestId}-footer`);
  expect(getComputedStyle(band).backgroundColor).toBe(rgb(footerFor[footerTone].band));
  const text = screen.getByText(label);
  expect(band.contains(text)).toBe(true);
  expect(getComputedStyle(text).color).toBe(rgb(footerFor[footerTone].text));
}

describe('Card', () => {
  it('is a white surface with the card radius and shadow', () => {
    render(
      <Card testID="card">
        <Text>Cutover frmJobControl to Blazor</Text>
      </Card>,
    );
    const card = screen.getByTestId('card');
    const style = getComputedStyle(card);
    expect(screen.getByText('Cutover frmJobControl to Blazor')).toBeTruthy();
    expect(style.backgroundColor).toBe(rgb(color.surface));
    expect(style.borderTopLeftRadius).toBe(`${radius.card}px`);
    expect(style.boxShadow).toBe(shadow.card);
    // The radius clips the square sections and footer band.
    expect(style.overflowX).toBe('hidden');
    expect(style.overflowY).toBe('hidden');
    expect(screen.queryByTestId('card-footer')).toBeNull();
  });

  describe.each(artboard6)('artboard 6 · $state', ({ tone: cardTone, footer }) => {
    it(`has the ${cardTone} outline and ${footer ? `the ${footer.tone} footer band` : 'no footer'}`, () => {
      render(<Card testID="card" tone={cardTone} {...(footer ? { footer } : {})} />);
      expectOutline(screen.getByTestId('card'), cardTone);
      if (footer) {
        expectFooter('card', footer.tone, footer.label);
      } else {
        expect(screen.queryByTestId('card-footer')).toBeNull();
      }
    });
  });

  const cardTones: CardTone[] = ['default', 'selected', 'attention', 'danger', 'muted'];
  const footerTones: (CardFooterTone | undefined)[] = [undefined, 'attention', 'ado', 'danger', 'ok'];
  const combinations = cardTones.flatMap((cardTone) => footerTones.map((footerTone) => ({ cardTone, footerTone })));

  it.each(combinations)('combines the $cardTone outline with footer $footerTone', ({ cardTone, footerTone }) => {
    const label = `Status · ${footerTone ?? 'none'}`;
    render(<Card testID="card" tone={cardTone} {...(footerTone ? { footer: { tone: footerTone, label } } : {})} />);
    expectOutline(screen.getByTestId('card'), cardTone);
    if (footerTone) expectFooter('card', footerTone, label);
    else expect(screen.queryByTestId('card-footer')).toBeNull();
  });

  it('renders a non-string footer label as given', () => {
    render(
      <Card
        testID="card"
        tone="attention"
        footer={{ tone: 'attention', label: <Text testID="custom-footer">⚠ Needs you · approve fixes</Text> }}
      />,
    );
    expect(screen.getByTestId('card-footer').contains(screen.getByTestId('custom-footer'))).toBe(true);
  });

  it('puts the footer band after the card content', () => {
    render(
      <Card testID="card" footer={{ tone: 'ok', label: 'Merged into main · 15:20' }}>
        <CardSection testID="body" tone="ok" />
      </Card>,
    );
    const card = screen.getByTestId('card');
    expect(card.lastElementChild).toBe(screen.getByTestId('card-footer'));
    expect(card.firstElementChild).toBe(screen.getByTestId('body'));
  });
});

describe('CardSection', () => {
  it('is untinted by default, with the card inset', () => {
    render(<CardSection testID="header" />);
    const style = getComputedStyle(screen.getByTestId('header'));
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(style.paddingLeft).toBe('14px');
    expect(style.paddingRight).toBe('14px');
  });

  const washes: [CardSectionTone, string][] = [
    ['claude', tone.claude.wash],
    ['ado', tone.ado.wash],
    ['danger', tone.danger.wash],
    ['ok', tone.ok.wash],
  ];

  it.each(washes)('%s section uses its wash tint', (sectionTone, wash) => {
    render(<CardSection testID="body" tone={sectionTone} />);
    expect(getComputedStyle(screen.getByTestId('body')).backgroundColor).toBe(rgb(wash));
  });
});
