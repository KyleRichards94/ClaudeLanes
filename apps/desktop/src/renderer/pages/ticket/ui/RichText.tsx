import { useMemo } from 'react';
import { Linking, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Text } from '@agent-lanes/ui';
import { htmlToBlocks, markdownToBlocks, type RichBlock, type RichSpan } from '../lib/rich-text';

export interface RichTextProps {
  /** Text as Azure DevOps stores it. It is read into plain blocks first and never rendered as HTML. */
  source: string;
  format?: 'html' | 'markdown';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Azure DevOps rich text (descriptions, acceptance criteria, comments) as React Native text (AL-180,
 * R6): paragraphs, headings, list items, quotes and code, with bold, italic, code and http(s) links
 * inside them. The source goes through `htmlToBlocks` / `markdownToBlocks`, so no markup reaches the
 * page.
 */
export function RichText({ source, format = 'html', style, testID }: RichTextProps) {
  const blocks = useMemo(() => (format === 'markdown' ? markdownToBlocks(source) : htmlToBlocks(source)), [source, format]);
  return (
    <View style={[styles.body, style]} testID={testID}>
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </View>
  );
}

function Block({ block }: { block: RichBlock }) {
  const content = block.spans.map((span, index) => <Span key={index} span={span} />);
  switch (block.kind) {
    case 'heading':
      return (
        <Text variant="title" size="lg" role="heading" selectable>
          {content}
        </Text>
      );
    case 'list-item':
      return (
        <View style={[styles.item, { paddingLeft: space.lg * ((block.depth ?? 1) - 1) }]}>
          <Text variant="body" color={color.muted} style={styles.marker} aria-hidden>
            {block.marker ?? '•'}
          </Text>
          <Text variant="body" selectable style={styles.itemText}>
            {content}
          </Text>
        </View>
      );
    case 'quote':
      return (
        <View style={styles.quote}>
          <Text variant="body" color={color.muted} selectable>
            {content}
          </Text>
        </View>
      );
    case 'code':
      return (
        <View style={styles.code}>
          <Text variant="mono" selectable>
            {content}
          </Text>
        </View>
      );
    case 'paragraph':
      return (
        <Text variant="body" selectable>
          {content}
        </Text>
      );
  }
}

function Span({ span }: { span: RichSpan }) {
  const style = [span.bold && styles.bold, span.italic && styles.italic];
  if (span.href) {
    const href = span.href;
    return (
      <Text
        role="link"
        variant={span.code ? 'mono' : undefined}
        color={tone.ado.text}
        style={[...style, styles.link]}
        onPress={() => void Linking.openURL(href)}
      >
        {span.text}
      </Text>
    );
  }
  return (
    <Text variant={span.code ? 'mono' : undefined} style={style}>
      {span.text}
    </Text>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: space.sm,
  },
  item: {
    flexDirection: 'row',
    gap: space.sm,
  },
  marker: {
    minWidth: space.lg,
  },
  itemText: {
    flex: 1,
    minWidth: 0,
  },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: color.line,
    paddingLeft: space.md,
  },
  code: {
    padding: space.md,
    borderRadius: radius.chip,
    backgroundColor: tone.neutral.band,
  },
  bold: {
    fontWeight: '700',
  },
  italic: {
    fontStyle: 'italic',
  },
  link: {
    textDecorationLine: 'underline',
  },
});
