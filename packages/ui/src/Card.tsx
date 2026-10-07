import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { color, mutedOpacity, radius, shadow, tone } from '@agent-lanes/tokens';
import { Text } from './Text';

/**
 * Card outline, from the "Agent card states" artboard: `selected` violet, `attention` amber
 * (needs approval, QA gap), `danger` red (build failed), `muted` for merged (the whole card fades).
 */
export type CardTone = 'default' | 'selected' | 'attention' | 'danger' | 'muted';

/** Footer band tint: `attention` "Needs you · …", `ado` "Switching · …", `danger` "Build failed · …", `ok`. */
export type CardFooterTone = 'attention' | 'ado' | 'danger' | 'ok';

/** Body tint behind a card's activity: violet while Claude works, then ADO blue, red or green. */
export type CardSectionTone = 'claude' | 'ado' | 'danger' | 'ok';

export interface CardFooter {
  tone: CardFooterTone;
  /** A string is set in the band's bold status style; any other node renders as given. */
  label: ReactNode;
}

export interface CardProps {
  tone?: CardTone;
  /** Optional status band along the bottom edge. Carry a word, not only the tint (design §11). */
  footer?: CardFooter;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  testID?: string;
}

/** White rounded surface (radius 16, card shadow) with an optional state outline and footer band. */
export function Card({ tone = 'default', footer, style, children, testID }: CardProps) {
  return (
    <View testID={testID} style={[styles.card, toneStyles[tone], style]}>
      {children}
      {footer ? (
        <View testID={testID ? `${testID}-footer` : undefined} style={[styles.footer, footerStyles[footer.tone]]}>
          {typeof footer.label === 'string' ? (
            <Text variant="title" size="sm" color={footerTextColor[footer.tone]}>
              {footer.label}
            </Text>
          ) : (
            footer.label
          )}
        </View>
      ) : null}
    </View>
  );
}

export interface CardSectionProps {
  /** Omit for the plain white header area; set a tone for the tinted activity area. */
  tone?: CardSectionTone;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  testID?: string;
}

/** A full-width band inside a Card with the card's padding, optionally tinted. */
export function CardSection({ tone: sectionTone, style, children, testID }: CardSectionProps) {
  return (
    <View testID={testID} style={[styles.section, sectionTone && sectionStyles[sectionTone], style]}>
      {children}
    </View>
  );
}

/** Horizontal inset read off artboard 6 (ids, titles and bars sit 14 px in from the card edge). */
const inset = 14;

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.line,
    boxShadow: shadow.card,
    // Sections and the footer band are square; the card's radius clips them.
    overflow: 'hidden',
  },
  section: {
    paddingHorizontal: inset,
    paddingVertical: 12,
  },
  footer: {
    paddingHorizontal: inset,
    paddingVertical: 5,
  },
});

const toneStyles = StyleSheet.create({
  default: {},
  selected: { borderColor: tone.claude.border },
  attention: { borderColor: tone.attention.border },
  danger: { borderColor: tone.danger.border },
  muted: { opacity: mutedOpacity },
});

const footerStyles = StyleSheet.create({
  attention: { backgroundColor: tone.attention.band },
  ado: { backgroundColor: tone.ado.band },
  danger: { backgroundColor: tone.danger.band },
  ok: { backgroundColor: tone.ok.band },
});

/** Footer labels are bold 12/16 (`title` at `sm`) in the tone's text colour. */
const footerTextColor: Record<CardFooterTone, string> = {
  attention: tone.attention.text,
  ado: tone.ado.text,
  danger: tone.danger.text,
  ok: tone.ok.text,
};

const sectionStyles = StyleSheet.create({
  claude: { backgroundColor: tone.claude.wash },
  ado: { backgroundColor: tone.ado.wash },
  danger: { backgroundColor: tone.danger.wash },
  ok: { backgroundColor: tone.ok.wash },
});
