import { createContext, useContext, type ReactNode } from 'react';
import {
  StyleSheet,
  Text as NativeText,
  type StyleProp,
  type TextProps as NativeTextProps,
  type TextStyle,
} from 'react-native';
import { color, font, fontSize, fontWeight } from '@agent-lanes/tokens';

/**
 * The app's type ramp (design §11 Type, artboard 7):
 * - `display`: Plus Jakarta Sans 800, page titles ("Agent board").
 * - `title`: 700, card titles and panel headings.
 * - `body`: 500, body copy, labels and controls.
 * - `meta`: 500 in the muted ink, secondary lines ("Opus · XHigh", "Active").
 * - `mono`: JetBrains Mono 400, ids, branches, logs and diffs.
 */
export type TextVariant = 'display' | 'title' | 'body' | 'meta' | 'mono';

/** A step of the `fontSize` token scale. */
export type TextSize = keyof typeof fontSize;

/** Every variant, for the component gallery and tests. */
export const textVariants: readonly TextVariant[] = ['display', 'title', 'body', 'meta', 'mono'];

const textSizes = Object.keys(fontSize) as TextSize[];

interface VariantSpec {
  fontFamily: string;
  fontWeight: TextStyle['fontWeight'];
  color: string;
  /** Size when the caller sets none. */
  size: TextSize;
  /** Line height as a multiple of the font size, rounded to whole pixels. */
  leading: number;
  /** Letter spacing in em. */
  tracking: number;
}

/**
 * Sizes and leading read off artboards 1, 3, 6 and 7: card titles 14/18, card meta 12/16,
 * the board title 40/44 with -1 px tracking, logs and ids in 12 px mono with room between lines.
 */
const variants: Record<TextVariant, VariantSpec> = {
  display: { fontFamily: font.sans, fontWeight: fontWeight.display, color: color.ink, size: 'display', leading: 1.1, tracking: -0.025 },
  title: { fontFamily: font.sans, fontWeight: fontWeight.heading, color: color.ink, size: 'md', leading: 1.3, tracking: 0 },
  body: { fontFamily: font.sans, fontWeight: fontWeight.body, color: color.ink, size: 'md', leading: 1.45, tracking: 0 },
  meta: { fontFamily: font.sans, fontWeight: fontWeight.body, color: color.muted, size: 'sm', leading: 1.35, tracking: 0 },
  mono: { fontFamily: font.mono, fontWeight: fontWeight.mono, color: color.ink, size: 'sm', leading: 1.5, tracking: 0 },
};

function faceOf(variant: TextVariant): TextStyle {
  const { fontFamily, fontWeight: weight, color: ink } = variants[variant];
  return { fontFamily, fontWeight: weight, color: ink };
}

function metricsOf(variant: TextVariant, size: TextSize): TextStyle {
  const { leading, tracking } = variants[variant];
  const px = fontSize[size];
  const sized: TextStyle = { fontSize: px, lineHeight: Math.round(px * leading) };
  return tracking === 0 ? sized : { ...sized, letterSpacing: Math.round(px * tracking * 100) / 100 };
}

type MetricsKey = `${TextVariant}-${TextSize}`;

// Built once, so react-native-web compiles each variant and size to shared CSS classes.
const faces = StyleSheet.create(
  Object.fromEntries(textVariants.map((variant) => [variant, faceOf(variant)])) as Record<TextVariant, TextStyle>,
);
const metrics = StyleSheet.create(
  Object.fromEntries(
    textVariants.flatMap((variant) => textSizes.map((size) => [`${variant}-${size}`, metricsOf(variant, size)])),
  ) as Record<MetricsKey, TextStyle>,
);

/**
 * The plain style of a variant (family, weight, colour, size, line height), for text the `Text`
 * primitive cannot render itself, such as a `TextInput` value or placeholder.
 */
export function textStyle(variant: TextVariant, size: TextSize = variants[variant].size): TextStyle {
  return { ...faceOf(variant), ...metricsOf(variant, size) };
}

/** The variant of the enclosing `Text`, or null at the top level. */
const EnclosingVariant = createContext<TextVariant | null>(null);

export interface TextProps extends Omit<NativeTextProps, 'style' | 'children'> {
  /**
   * Type style. Defaults to `body`. A `Text` nested in another inherits the outer variant
   * unless it sets its own; a nested variant changes the face and colour and keeps the
   * outer size unless `size` is set too.
   */
  variant?: TextVariant;
  /** Overrides the variant's size with a step of the `fontSize` scale. */
  size?: TextSize;
  /** Overrides the variant's colour, e.g. white on a violet button or a tone's text on its band. */
  color?: string;
  /**
   * Lets the user select and copy the text (logs, diffs, error details). Off by default, as in
   * React Native, so dragging across the board doesn't highlight labels. Nested text follows
   * its parent unless set.
   */
  selectable?: boolean;
  /** Layout extras (margins, alignment). Set type through `variant`, `size` and `color`. */
  style?: StyleProp<TextStyle>;
  children?: ReactNode;
}

/** All text in the app goes through this, in one of the five variants (design §11 Type). */
export function Text({ variant, size, color: colorOverride, selectable, style, children, ...rest }: TextProps) {
  const enclosing = useContext(EnclosingVariant);
  const nested = enclosing !== null;
  const resolved = variant ?? enclosing ?? 'body';
  // Top-level text gets the full variant; nested text only what it changes, inheriting the rest.
  const face = !nested || variant ? faces[resolved] : undefined;
  const metricsSize = size ?? (nested ? undefined : variants[resolved].size);
  const sized = metricsSize ? metrics[`${resolved}-${metricsSize}`] : undefined;

  return (
    <EnclosingVariant.Provider value={resolved}>
      <NativeText
        {...rest}
        selectable={selectable ?? (nested ? undefined : false)}
        style={[face, sized, colorOverride ? { color: colorOverride } : undefined, style]}
      >
        {children}
      </NativeText>
    </EnclosingVariant.Provider>
  );
}
