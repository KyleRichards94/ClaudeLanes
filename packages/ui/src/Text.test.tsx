import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { color, font, fontSize, fontWeight, tone } from '@agent-lanes/tokens';
import { Text, textStyle, textVariants, type TextVariant } from './Text';

/** jsdom reports computed colours as rgb(); tokens are #RRGGBB. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/** WCAG 2 contrast ratio of a computed `rgb(r, g, b)` text colour on a #RRGGBB background. */
function contrast(computedRgb: string, backgroundHex: string): number {
  const channels = (/^rgb\((\d+), (\d+), (\d+)\)$/.exec(computedRgb) ?? []).slice(1).map(Number);
  expect(channels, `not an opaque rgb() colour: ${computedRgb}`).toHaveLength(3);
  const background = [1, 3, 5].map((i) => parseInt(backgroundHex.slice(i, i + 2), 16));
  const luminance = ([r = 0, g = 0, b = 0]: number[]) => {
    const [lr = 0, lg = 0, lb = 0] = [r, g, b].map((value) => {
      const c = value / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  };
  const [hi, lo] = [luminance(channels), luminance(background)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** What each variant must render as at its default size (design §11 Type, artboards 1, 6, 7). */
const expected: Record<TextVariant, { family: string; weight: string; size: number; lineHeight: number; ink: string }> = {
  display: { family: font.sans, weight: fontWeight.display, size: fontSize.display, lineHeight: 44, ink: color.ink },
  title: { family: font.sans, weight: fontWeight.heading, size: fontSize.md, lineHeight: 18, ink: color.ink },
  body: { family: font.sans, weight: fontWeight.body, size: fontSize.md, lineHeight: 20, ink: color.ink },
  meta: { family: font.sans, weight: fontWeight.body, size: fontSize.sm, lineHeight: 16, ink: color.muted },
  mono: { family: font.mono, weight: fontWeight.mono, size: fontSize.sm, lineHeight: 18, ink: color.ink },
};

const keysOf = <T extends object>(record: T) => Object.keys(record) as (keyof T)[];

function styleOf(text: string): CSSStyleDeclaration {
  return getComputedStyle(screen.getByText(text));
}

describe('Text', () => {
  it('has the five variants from the ticket', () => {
    expect([...textVariants]).toEqual(['display', 'title', 'body', 'meta', 'mono']);
  });

  it.each(textVariants)('renders the %s variant in its face, size and colour', (variant) => {
    render(<Text variant={variant}>Cutover frmJobControl to Blazor</Text>);
    const style = styleOf('Cutover frmJobControl to Blazor');
    const want = expected[variant];

    expect(style.fontFamily).toBe(want.family);
    expect(style.fontWeight).toBe(want.weight);
    expect(style.fontSize).toBe(`${want.size}px`);
    expect(style.lineHeight).toBe(`${want.lineHeight}px`);
    expect(style.color).toBe(rgb(want.ink));
  });

  it('is body text when no variant is given', () => {
    render(<Text>Plan ready for review</Text>);
    const style = styleOf('Plan ready for review');
    expect(style.fontWeight).toBe(fontWeight.body);
    expect(style.fontSize).toBe(`${fontSize.md}px`);
    expect(style.color).toBe(rgb(color.ink));
  });

  it('tightens display text to -1 px at 40 px, as on the board title', () => {
    render(<Text variant="display">Agent board</Text>);
    expect(styleOf('Agent board').letterSpacing).toBe('-1px');
  });

  it('takes a size from the fontSize scale and keeps the variant leading', () => {
    render(
      <Text variant="title" size="lg">
        Sub-agents
      </Text>,
    );
    const style = styleOf('Sub-agents');
    expect(style.fontSize).toBe(`${fontSize.lg}px`);
    expect(style.lineHeight).toBe('21px'); // 16 × 1.3, rounded
    expect(style.fontWeight).toBe(fontWeight.heading);
  });

  it('takes a colour override, such as a tone text on its band', () => {
    render(
      <Text variant="title" size="sm" color={tone.attention.text}>
        Needs you · approve plan
      </Text>,
    );
    expect(styleOf('Needs you · approve plan').color).toBe(rgb(tone.attention.text));
  });

  it('passes React Native props through: role, level, testID, style', () => {
    render(
      <Text variant="display" role="heading" aria-level={1} testID="board-title" style={{ textAlign: 'center' }}>
        Agent board
      </Text>,
    );
    const heading = screen.getByRole('heading', { level: 1, name: 'Agent board' });
    expect(heading).toBe(screen.getByTestId('board-title'));
    expect(getComputedStyle(heading).textAlign).toBe('center');
  });

  describe('selectable', () => {
    it('is off by default, as in React Native', () => {
      render(<Text variant="meta">Opus · XHigh</Text>);
      expect(styleOf('Opus · XHigh').userSelect).toBe('none');
    });

    it('lets logs and diffs be selected and copied', () => {
      render(
        <Text variant="mono" selectable>
          dotnet build OnSite.Blazor.csproj 0 errors
        </Text>,
      );
      expect(styleOf('dotnet build OnSite.Blazor.csproj 0 errors').userSelect).toBe('text');
    });

    it('lets nested text follow its parent unless set', () => {
      render(
        <Text variant="mono" selectable testID="line">
          <Text testID="inherits">Edit </Text>
          <Text testID="opts-out" selectable={false}>
            +214
          </Text>
        </Text>,
      );
      // No own user-select, so CSS inheritance from the selectable line applies.
      expect(screen.getByTestId('inherits').style.userSelect).toBe('');
      expect(getComputedStyle(screen.getByTestId('inherits')).userSelect).not.toBe('none');
      expect(getComputedStyle(screen.getByTestId('opts-out')).userSelect).toBe('none');
    });
  });

  describe('nested text', () => {
    it('inherits the outer variant and size when it sets neither', () => {
      render(
        <Text variant="meta" size="xs" testID="outer">
          Opus · <Text testID="inner">XHigh</Text>
        </Text>,
      );
      const outer = getComputedStyle(screen.getByTestId('outer'));
      const inner = getComputedStyle(screen.getByTestId('inner'));
      expect(inner.fontSize).toBe(outer.fontSize);
      expect(inner.fontSize).toBe(`${fontSize.xs}px`);
      expect(inner.color).toBe(rgb(color.muted));
      expect(inner.fontWeight).toBe(outer.fontWeight);
    });

    it('changes face and colour for a nested variant but keeps the outer size', () => {
      render(
        <Text variant="body" size="lg">
          I'm cutting over <Text variant="title">frmJobFilter</Text> with the parent, and{' '}
          <Text variant="mono">Pages/Jobs/JobControl.razor</Text> is next.
        </Text>,
      );
      const emphasis = styleOf('frmJobFilter');
      expect(emphasis.fontWeight).toBe(fontWeight.heading);
      expect(emphasis.fontSize).toBe(`${fontSize.lg}px`);

      const path = styleOf('Pages/Jobs/JobControl.razor');
      expect(path.fontFamily).toBe(font.mono);
      expect(path.fontWeight).toBe(fontWeight.mono);
      expect(path.fontSize).toBe(`${fontSize.lg}px`);
    });

    it('sizes a nested span when asked', () => {
      render(
        <Text variant="meta">
          Sub-agents{' '}
          <Text variant="title" size="md">
            7
          </Text>
        </Text>,
      );
      expect(styleOf('7').fontSize).toBe(`${fontSize.md}px`);
    });
  });

  describe('textStyle', () => {
    it('gives the same style for text Text cannot render, such as a TextInput value', () => {
      expect(textStyle('body')).toEqual({
        fontFamily: font.sans,
        fontWeight: fontWeight.body,
        color: color.ink,
        fontSize: fontSize.md,
        lineHeight: 20,
      });
      expect(textStyle('display')).toMatchObject({ fontSize: fontSize.display, lineHeight: 44, letterSpacing: -1 });
      expect(textStyle('mono', 'md')).toMatchObject({ fontFamily: font.mono, fontSize: fontSize.md, lineHeight: 21 });
    });
  });

  describe('contrast (design §11: text meets 4.5:1)', () => {
    const grounds = { bg: color.bg, surface: color.surface } as const;

    it.each(textVariants.flatMap((variant) => keysOf(grounds).map((ground) => [variant, ground] as const)))(
      '%s text on %s meets 4.5:1',
      (variant, ground) => {
        render(<Text variant={variant}>Sample</Text>);
        expect(contrast(styleOf('Sample').color, grounds[ground])).toBeGreaterThanOrEqual(4.5);
      },
    );

    // Card activity sections (artboard 6) put body and meta text on these washes.
    const washes = { claude: tone.claude.wash, ado: tone.ado.wash, danger: tone.danger.wash, ok: tone.ok.wash } as const;

    it.each(textVariants.flatMap((variant) => keysOf(washes).map((wash) => [variant, wash] as const)))(
      '%s text on the %s card wash meets 4.5:1',
      (variant, wash) => {
        render(<Text variant={variant}>Sample</Text>);
        expect(contrast(styleOf('Sample').color, washes[wash])).toBeGreaterThanOrEqual(4.5);
      },
    );
  });
});
