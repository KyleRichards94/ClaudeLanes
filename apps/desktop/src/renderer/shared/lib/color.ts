/** Colour helpers for the Code City faces and other computed tints. Hex in, hex out (`#RRGGBB`). */

function parse(hex: string): [number, number, number] {
  let body = hex.trim().replace(/^#/, '');
  if (body.length === 3) body = body.replace(/./g, (c) => c + c);
  if (!/^[0-9a-f]{6}$/i.test(body)) throw new Error(`Not a hex colour: ${hex}`);
  return [parseInt(body.slice(0, 2), 16), parseInt(body.slice(2, 4), 16), parseInt(body.slice(4, 6), 16)];
}

function format(channels: readonly number[]): string {
  return `#${channels.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** `a` blended towards `b` by `t` (0 = a, 1 = b). */
export function mix(hexA: string, hexB: string, t: number): string {
  const weight = Math.min(1, Math.max(0, t));
  const a = parse(hexA);
  const b = parse(hexB);
  return format(a.map((v, i) => v + ((b[i] ?? 0) - v) * weight));
}

/** Lightens (amount > 0, towards white) or darkens (amount < 0, towards black) by a fraction from -1 to 1. */
export function shade(hex: string, amount: number): string {
  const clamped = Math.min(1, Math.max(-1, amount));
  return clamped >= 0 ? mix(hex, '#FFFFFF', clamped) : mix(hex, '#000000', -clamped);
}
