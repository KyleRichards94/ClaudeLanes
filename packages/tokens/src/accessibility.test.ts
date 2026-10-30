import { describe, expect, it } from 'vitest';
import { MIN_TEXT_CONTRAST, MIN_UI_CONTRAST, THEMES, blendOver, contrastRatio, mutedOpacity, parseHex, themes, type Rgb, type Theme, type ThemePalette } from './index';

/**
 * AL-033: every text/background and meaningful UI colour pair the app draws, with WCAG 2 contrast
 * (design §11: text 4.5:1; UI parts 3:1), in every theme. A pair below its minimum on purpose is
 * listed in `exemptions` for that theme with the reason.
 */

type Colour = string | Rgb;
interface Pair {
  where: string;
  fg: Colour;
  bg: Colour;
  minimum: number;
}

/** Glass at its thinnest fill over the app ground: toasts, modals, the header. */
function glassOverGround({ glass, color }: ThemePalette): Rgb {
  const match = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(glass.fillMin);
  if (!match) throw new Error(`glass.fillMin is not rgba(): ${glass.fillMin}`);
  return blendOver([Number(match[1]), Number(match[2]), Number(match[3])], color.bg, Number(match[4]));
}

function pairsOf(palette: ThemePalette): Pair[] {
  const { color, tone, selection, control } = palette;
  const glass = glassOverGround(palette);
  const text = (where: string, fg: Colour, bg: Colour): Pair => ({ where, fg, bg, minimum: MIN_TEXT_CONTRAST });
  const ui = (where: string, fg: Colour, bg: Colour): Pair => ({ where, fg, bg, minimum: MIN_UI_CONTRAST });
  const washes = ['claude', 'ado', 'danger', 'ok'] as const;
  return [
    ...(['ink', 'muted'] as const).flatMap((ink) => [
      text(`${ink} text on the app ground`, color[ink], color.bg),
      text(`${ink} text on cards and panels`, color[ink], color.surface),
      text(`${ink} text on glass`, color[ink], glass),
      ...washes.map((wash) => text(`${ink} text on the ${wash} card wash`, color[ink], tone[wash].wash)),
    ]),
    text('TextField placeholder (muted) on a disabled field (bg)', color.muted, color.bg),
    text('muted text on the segmented track', color.muted, selection.track),
    text('unselected segment / switch side text on the track', selection.label, selection.track),
    text('unselected effort pill text on the surface', selection.label, color.surface),
    text('selected segment label (claude) on the surface', color.claude, color.surface),
    text('Primary button label', color.onAccent, color.claude),
    text('Strong button label', color.onInk, control.strongFill),
    text('Secondary button label', control.ink, color.surface),
    text('Soft button label', color.claudeText, color.claudeTint),
    text('Danger button label (Remove) and TextField error text', color.danger, color.surface),
    text('IdChip on the ADO tint', tone.ado.text, color.adoTint),
    ...Object.entries(tone).map(([name, values]) => text(`${name} pill / footer band text`, values.text, values.band)),
    ...washes.map((wash) => text(`${wash} activity text on its card wash`, tone[wash].text, tone[wash].wash)),
    // A merged card fades as a whole: opacity blends text and fill toward the ground; grayscale keeps luminance.
    ...(
      [
        ['muted text', color.muted, color.surface],
        ['muted text on the ok wash', color.muted, tone.ok.wash],
        ['ink title', color.ink, color.surface],
        ['activity text on the ok wash', tone.ok.text, tone.ok.wash],
        ['IdChip', tone.ado.text, color.adoTint],
      ] as const
    ).map(([what, fg, bg]) => text(`merged card: ${what}, faded`, blendOver(fg, color.bg, mutedOpacity), blendOver(bg, color.bg, mutedOpacity))),
    ui('focus ring on the app ground', color.claude, color.bg),
    ui('focus ring on cards and fields', color.claude, color.surface),
    ui('switch track when on', color.claude, color.surface),
    ui('selected effort pill fill', color.claude, color.surface),
    ui('TextField error outline', color.danger, color.surface),
    ui('running progress fill on its track', color.claude, color.line),
    ...washes.map((name) => ui(`${name} status dot on its pill`, tone[name].dot, tone[name].band)),
    ui('switch track when off', selection.switchOff, color.surface),
    ui('TextField border', color.line, color.surface),
    ui('ADO progress fill on its track', tone.ado.fill, color.line),
    ui('failed progress fill on its track', tone.danger.fill, color.line),
    ui('merged progress fill on its track', tone.ok.fill, color.line),
    ui('attention status dot on its pill', tone.attention.dot, tone.attention.band),
    ui('neutral (Queued) status dot on its pill', tone.neutral.dot, tone.neutral.band),
  ];
}

const SWITCH_OFF = 'The state is shown by the knob position and the side-text word ("Auto"), never by the track colour (D291).';
const FIELD_BORDER = 'Fields are identified by their visible label and the 46 px box; the outline is not the only cue. Focus adds the ring (3:1+).';
const PROGRESS_FILL = 'Supplementary: the card states the same thing in words beside the bar, and the bar exposes aria-valuenow.';
const DECORATIVE_DOT = 'Decorative: every pill carries its word, so the dot never carries the meaning alone.';

/** Pairs below their minimum on purpose, per theme. A listed pair that passes must come off the list. */
const exemptions: Record<Theme, Record<string, string>> = {
  light: {
    'switch track when off': SWITCH_OFF,
    'TextField border': FIELD_BORDER,
    'ADO progress fill on its track': PROGRESS_FILL,
    'failed progress fill on its track': PROGRESS_FILL,
    'merged progress fill on its track': PROGRESS_FILL,
    'attention status dot on its pill': DECORATIVE_DOT,
    'neutral (Queued) status dot on its pill': DECORATIVE_DOT,
  },
  dark: {
    'switch track when off': SWITCH_OFF,
    'TextField border': FIELD_BORDER,
    'selected segment label (claude) on the surface':
      "Dark's selected segment sits on selection.thumb, not the surface, and its label is claudeText (selection.test.ts). Pre-existing from AL-285, recorded in D825.",
    'running progress fill on its track': 'Pre-existing from AL-285: the dark violet is 2.0:1 on the dark line. Recorded in D825, not changed here.',
    'claude status dot on its pill': 'Pre-existing from AL-285: 2.7:1 on the claude band. Recorded in D825, not changed here.',
  },
  solarpunk: {
    'switch track when off': SWITCH_OFF,
    'TextField border': FIELD_BORDER,
    'ADO progress fill on its track': PROGRESS_FILL,
    'failed progress fill on its track': PROGRESS_FILL,
    'merged progress fill on its track': PROGRESS_FILL,
    'neutral (Queued) status dot on its pill': DECORATIVE_DOT,
  },
  cyberpunk: {
    'switch track when off': SWITCH_OFF,
    'TextField border': FIELD_BORDER,
  },
};

describe.each(THEMES)('%s: contrast of the token pairs in use (AL-033)', (theme) => {
  const exempt = exemptions[theme];
  const pairs = pairsOf(themes[theme]);
  const checked = pairs.filter((pair) => !(pair.where in exempt));
  const excused = pairs.filter((pair) => pair.where in exempt);

  it.each(checked.map((pair) => [pair.where, pair] as const))('%s meets its minimum', (_where, pair) => {
    expect(contrastRatio(pair.fg, pair.bg)).toBeGreaterThanOrEqual(pair.minimum);
  });

  it.each(excused.map((pair) => [pair.where, pair] as const))('exempt: %s is still below its minimum, with a reason', (where, pair) => {
    // If this fails the pair now passes: take it out of `exemptions`.
    expect(contrastRatio(pair.fg, pair.bg)).toBeLessThan(pair.minimum);
    expect(exempt[where]?.length ?? 0).toBeGreaterThan(10);
  });

  it('exempts only pairs that exist', () => {
    const names = pairs.map((pair) => pair.where);
    for (const where of Object.keys(exempt)) expect(names).toContain(where);
  });
});

it('computes WCAG ratios', () => {
  expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  expect(contrastRatio(themes.light.color.ink, themes.light.color.ink)).toBe(1);
  expect(parseHex('#5B4BC4')).toEqual([91, 75, 196]);
  expect(blendOver('#000000', '#FFFFFF', 0.5)).toEqual([127.5, 127.5, 127.5]);
});
