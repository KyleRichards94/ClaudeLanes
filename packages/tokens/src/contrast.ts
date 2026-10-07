/**
 * WCAG 2 contrast helpers (design §11 Accessibility, AL-033): text needs 4.5:1 on its background
 * (3:1 for large text), and user interface parts that carry meaning need 3:1 (WCAG 1.4.11).
 */

/** Body text (WCAG 1.4.3). */
export const MIN_TEXT_CONTRAST = 4.5;
/** Large text (24 px, or 18.66 px bold) and meaningful UI graphics such as a focus ring (WCAG 1.4.3, 1.4.11). */
export const MIN_LARGE_TEXT_CONTRAST = 3;
export const MIN_UI_CONTRAST = 3;

export type Rgb = readonly [number, number, number];

/** `#RRGGBB` → `[r, g, b]` (0–255). */
export function parseHex(hex: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Not a #RRGGBB colour: ${hex}`);
  return [parseInt(match[1] ?? '0', 16), parseInt(match[2] ?? '0', 16), parseInt(match[3] ?? '0', 16)];
}

/** WCAG relative luminance. */
export function relativeLuminance(colour: string | Rgb): number {
  const [r, g, b] = (typeof colour === 'string' ? parseHex(colour) : colour).map((value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two colours, 1–21. */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** A colour drawn at `alpha` opacity over `background`, as the eye sees it. */
export function blendOver(colour: string | Rgb, background: string | Rgb, alpha: number): Rgb {
  const fg = typeof colour === 'string' ? parseHex(colour) : colour;
  const bg = typeof background === 'string' ? parseHex(background) : background;
  return [0, 1, 2].map((i) => (fg[i] ?? 0) * alpha + (bg[i] ?? 0) * (1 - alpha)) as unknown as Rgb;
}
