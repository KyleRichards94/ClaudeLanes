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
  fillMin: 'rgba(255, 252, 240, 0.62)',
  fillMax: 'rgba(255, 252, 240, 0.74)',
  highlight: 'inset 0 1px 0 rgba(255, 255, 255, 0.9)',
  border: 'rgba(255, 255, 255, 0.7)',
};

export const cyberpunkGlass: GlassPalette = {
  fillMin: 'rgba(14, 12, 32, 0.72)',
  fillMax: 'rgba(14, 12, 32, 0.84)',
  highlight: 'inset 0 1px 0 rgba(247, 47, 208, 0.22)',
  border: 'rgba(46, 230, 255, 0.2)',
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
  card: '0 1px 2px rgba(31, 42, 30, 0.05), 0 8px 24px rgba(31, 42, 30, 0.08)',
  lifted: '0 2px 4px rgba(31, 42, 30, 0.07), 0 16px 40px rgba(31, 42, 30, 0.12)',
};

export const cyberpunkShadow: ShadowPalette = {
  card: '0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(247, 47, 208, 0.12)',
  lifted: '0 2px 4px rgba(0, 0, 0, 0.45), 0 16px 40px rgba(247, 47, 208, 0.18)',
};
