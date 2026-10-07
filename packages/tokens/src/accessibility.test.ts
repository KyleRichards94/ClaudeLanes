import { describe, expect, it } from 'vitest';
import {
  MIN_TEXT_CONTRAST,
  MIN_UI_CONTRAST,
  blendOver,
  color,
  contrastRatio,
  control,
  focusRing,
  glass,
  mutedOpacity,
  parseHex,
  progressGradient,
  selection,
  tone,
  type Rgb,
} from './index';

/**
 * AL-033: every text/background and meaningful UI colour pair the app draws, with WCAG 2 contrast
 * (design §11: text 4.5:1; large text and UI parts 3:1). A pair that is below its minimum on purpose
 * is listed in `exemptions` with the reason, so a new pair can't slip under the bar unnoticed.
 */

/** Glass at its thinnest fill (62 % white) over the app ground: toasts, modals, the header. */
const glassAlpha = Number(/,\s*([\d.]+)\)$/.exec(glass.fillMin)?.[1]);
const glassOverGround: Rgb = blendOver('#FFFFFF', color.bg, glassAlpha);

type Colour = string | Rgb;
interface Pair {
  /** Where the pair is drawn. */
  where: string;
  fg: Colour;
  bg: Colour;
}

/** Body and small text (4.5:1). */
const textPairs: Pair[] = [
  ...(['ink', 'muted'] as const).flatMap((ink) => [
    { where: `${ink} text on the app ground`, fg: color[ink], bg: color.bg },
    { where: `${ink} text on cards and panels`, fg: color[ink], bg: color.surface },
    { where: `${ink} text on glass`, fg: color[ink], bg: glassOverGround },
    ...(['claude', 'ado', 'danger', 'ok'] as const).map((wash) => ({ where: `${ink} text on the ${wash} card wash`, fg: color[ink], bg: tone[wash].wash })),
  ]),
  { where: 'TextField placeholder (muted) on a disabled field (bg)', fg: color.muted, bg: color.bg },
  { where: 'muted text on the segmented track', fg: color.muted, bg: selection.track },
  { where: 'unselected segment / switch side text on the track', fg: selection.label, bg: selection.track },
  { where: 'unselected effort pill text on white', fg: selection.label, bg: color.surface },
  { where: 'selected segment label (violet) on the white thumb', fg: color.claude, bg: color.surface },
  { where: 'Primary button label', fg: color.surface, bg: color.claude },
  { where: 'Strong button label', fg: color.surface, bg: color.ink },
  { where: 'Secondary button label', fg: control.ink, bg: color.surface },
  { where: 'Soft button label', fg: color.claudeText, bg: color.claudeTint },
  { where: 'Danger button label (Remove) and TextField error text', fg: color.danger, bg: color.surface },
  { where: 'IdChip on the ADO tint', fg: tone.ado.text, bg: color.adoTint },
  ...Object.entries(tone).map(([name, values]) => ({ where: `${name} pill / footer band text`, fg: values.text, bg: values.band })),
  ...(['claude', 'ado', 'danger', 'ok'] as const).map((wash) => ({
    where: `${wash} activity text on its card wash`,
    fg: tone[wash].text,
    bg: tone[wash].wash,
  })),
  // A merged card fades as a whole (Card tone `muted`): the opacity blends text and fill toward the
  // ground; the grayscale filter keeps luminance, so it leaves contrast where the opacity puts it.
  ...(
    [
      ['muted text', color.muted, color.surface],
      ['muted text on the ok wash', color.muted, tone.ok.wash],
      ['ink title', color.ink, color.surface],
      ['activity text on the ok wash', tone.ok.text, tone.ok.wash],
      ['IdChip', tone.ado.text, color.adoTint],
    ] as const
  ).map(([what, fg, bg]) => ({
    where: `merged card: ${what}, faded`,
    fg: blendOver(fg, color.bg, mutedOpacity),
    bg: blendOver(bg, color.bg, mutedOpacity),
  })),
];

/** UI parts that carry meaning on their own (3:1, WCAG 1.4.11). */
const uiPairs: Pair[] = [
  { where: 'focus ring on the app ground', fg: focusRing.color, bg: color.bg },
  { where: 'focus ring on cards and fields', fg: focusRing.color, bg: color.surface },
  { where: 'switch track when on', fg: color.claude, bg: color.surface },
  { where: 'selected effort pill fill', fg: color.claude, bg: color.surface },
  { where: 'TextField error outline', fg: color.danger, bg: color.surface },
  { where: 'running progress fill on its track', fg: progressGradient.from, bg: color.line },
  ...(['claude', 'ado', 'danger', 'ok'] as const).map((name) => ({
    where: `${name} status dot on its pill`,
    fg: tone[name].dot,
    bg: tone[name].band,
  })),
];

interface Exemption extends Pair {
  minimum: number;
  /** Why the pair may stay below the minimum (recorded in AL-033's decisions). */
  reason: string;
}

const exemptions: Exemption[] = [
  {
    where: 'switch track when off',
    fg: selection.switchOff,
    bg: color.surface,
    minimum: MIN_UI_CONTRAST,
    reason: 'The state is shown by the knob position and the side-text word ("Auto"), never by the track colour (D291).',
  },
  {
    where: 'TextField border',
    fg: color.line,
    bg: color.surface,
    minimum: MIN_UI_CONTRAST,
    reason: 'Fields are identified by their visible label and the 46 px box; the outline is not the only cue. Focus adds the violet ring (3:1+).',
  },
  ...(
    [
      ['ADO', tone.ado.fill],
      ['failed', tone.danger.fill],
      ['merged', tone.ok.fill],
    ] as const
  ).map(([name, fill]) => ({
    where: `${name} progress fill on its track`,
    fg: fill,
    bg: color.line,
    minimum: MIN_UI_CONTRAST,
    reason: 'Supplementary: the card states the same thing in words beside the bar, and the bar exposes aria-valuenow.',
  })),
  {
    where: 'attention status dot on its pill',
    fg: tone.attention.dot,
    bg: tone.attention.band,
    minimum: MIN_UI_CONTRAST,
    reason: 'Decorative: every pill carries its word ("Needs you"), so the dot never carries the meaning alone.',
  },
  {
    where: 'neutral (Queued) status dot on its pill',
    fg: tone.neutral.dot,
    bg: tone.neutral.band,
    minimum: MIN_UI_CONTRAST,
    reason: 'Decorative, as above.',
  },
];

const label = (pair: Pair) => pair.where;

describe('contrast of the token pairs in use (AL-033)', () => {
  it.each(textPairs.map((pair) => [label(pair), pair] as const))('text: %s meets 4.5:1', (_where, pair) => {
    expect(contrastRatio(pair.fg, pair.bg)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it.each(uiPairs.map((pair) => [label(pair), pair] as const))('UI: %s meets 3:1', (_where, pair) => {
    expect(contrastRatio(pair.fg, pair.bg)).toBeGreaterThanOrEqual(MIN_UI_CONTRAST);
  });

  it.each(exemptions.map((pair) => [label(pair), pair] as const))('exempt: %s is still below its minimum, with a reason', (_where, pair) => {
    // If this fails the pair now passes: move it from `exemptions` to the pairs above.
    expect(contrastRatio(pair.fg, pair.bg)).toBeLessThan(pair.minimum);
    expect(pair.reason.length).toBeGreaterThan(10);
  });

  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio(color.ink, color.ink)).toBe(1);
    expect(parseHex('#5B4BC4')).toEqual([91, 75, 196]);
    expect(blendOver('#000000', '#FFFFFF', 0.5)).toEqual([127.5, 127.5, 127.5]);
    expect(glassAlpha).toBe(0.62);
  });
});
