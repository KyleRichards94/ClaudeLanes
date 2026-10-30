export interface GlassPalette {
  fillMin: string;
  fillMax: string;
  /** The whole inset highlight, as `--al-glass-highlight` holds it. */
  highlight: string;
  border: string;
}

export interface ShadowPalette {
  card: string;
  lifted: string;
}

export const lightGlass: GlassPalette = {
  fillMin: 'rgba(255, 255, 255, 0.62)',
  fillMax: 'rgba(255, 255, 255, 0.72)',
  highlight: 'inset 0 1px 0 rgba(255, 255, 255, 0.9)',
  border: 'rgba(255, 255, 255, 0.7)',
};

export const darkGlass: GlassPalette = {
  fillMin: 'rgba(18, 26, 40, 0.74)',
  fillMax: 'rgba(18, 26, 40, 0.84)',
  highlight: 'inset 0 1px 0 rgba(255, 255, 255, 0.22)',
  border: 'rgba(255, 255, 255, 0.16)',
};

export const solarpunkGlass: GlassPalette = {
  fillMin: 'rgba(255, 251, 238, 0.66)',
  fillMax: 'rgba(255, 251, 238, 0.84)',
  highlight: 'inset 0 1px 0 rgba(255, 255, 255, 0.95), 0 6px 24px rgba(160, 112, 40, 0.1)',
  border: 'rgba(206, 160, 72, 0.55)',
};

export const cyberpunkGlass: GlassPalette = {
  fillMin: 'rgba(26, 22, 58, 0.72)',
  fillMax: 'rgba(26, 22, 58, 0.9)',
  highlight: 'inset 0 1px 0 rgba(255, 43, 214, 0.35), 0 0 26px rgba(0, 240, 255, 0.16)',
  border: 'rgba(0, 240, 255, 0.45)',
};

export const lightShadow: ShadowPalette = {
  card: '0 1px 2px rgba(15, 27, 45, 0.04), 0 8px 24px rgba(15, 27, 45, 0.06)',
  lifted: '0 2px 4px rgba(15, 27, 45, 0.06), 0 16px 40px rgba(15, 27, 45, 0.1)',
};

export const darkShadow: ShadowPalette = {
  card: '0 1px 2px rgba(0, 0, 0, 0.28), 0 8px 24px rgba(0, 0, 0, 0.35)',
  lifted: '0 2px 4px rgba(0, 0, 0, 0.32), 0 16px 40px rgba(0, 0, 0, 0.45)',
};

export const solarpunkShadow: ShadowPalette = {
  card: '0 1px 2px rgba(120, 84, 30, 0.1), 0 10px 26px rgba(120, 84, 30, 0.14)',
  lifted: '0 2px 4px rgba(120, 84, 30, 0.12), 0 18px 42px rgba(120, 84, 30, 0.2)',
};

export const cyberpunkShadow: ShadowPalette = {
  card: '0 0 0 1px rgba(0, 240, 255, 0.28), 0 0 16px rgba(0, 240, 255, 0.2), 0 10px 28px rgba(0, 0, 0, 0.55)',
  lifted: '0 0 0 1px rgba(0, 240, 255, 0.4), 0 0 24px rgba(0, 240, 255, 0.3), 0 16px 40px rgba(0, 0, 0, 0.6)',
};
