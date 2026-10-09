import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { color, font, fontSize, fontWeight, radius, space, tone } from '@agent-lanes/tokens';
import { Icon, Text } from '@agent-lanes/ui';
import { copyText } from '@/shared/lib';
import { highlight, languageOf, type TokenKind } from '../model/highlight';
import { parseMarkdown, spansText, type InlineSpan, type MarkdownBlock } from '../model/markdown';

export interface MarkdownProps {
  text: string;
  /** The text is still streaming in: the last block is drawn as it stands, with the caret after it. */
  streaming?: boolean;
  /** Muted violet while streaming (artboard 3's live line). */
  ink?: string;
  testID?: string;
}

/**
 * The agent's prose as Markdown (AL-255): headings, lists, fenced code with syntax colouring and a
 * Copy button, quotes, tables, rules; bold, italic, inline code and links that open in the browser.
 * Everything is React Native text and views; nothing from the agent is ever rendered as HTML.
 */
export function Markdown({ text, streaming = false, ink, testID }: MarkdownProps) {
  // Parsed once per text: a row re-renders when its neighbours change, its text does not.
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <View style={styles.blocks} testID={testID}>
      {blocks.map((block, index) => (
        <Block key={index} block={block} ink={ink} caret={streaming && index === blocks.length - 1} />
      ))}
      {streaming && blocks.length === 0 ? <Caret /> : null}
    </View>
  );
}

function Caret() {
  return (
    <Text color={color.claude} aria-hidden testID="output-caret">
      ▍
    </Text>
  );
}

function Block({ block, ink, caret }: { block: MarkdownBlock; ink?: string; caret: boolean }) {
  switch (block.kind) {
    case 'heading': {
      const size = block.level <= 1 ? 'xl' : block.level === 2 ? 'lg' : 'md';
      return (
        <Text variant="title" size={size} role="heading" aria-level={Math.min(block.level + 2, 6)} selectable style={styles.heading} testID="md-heading">
          <Spans spans={block.spans} ink={ink} />
          {caret ? <Caret /> : null}
        </Text>
      );
    }
    case 'paragraph':
      return (
        <Text variant="body" size="md" selectable style={styles.paragraph} color={ink} testID="md-paragraph">
          <Spans spans={block.spans} ink={ink} />
          {caret ? <Caret /> : null}
        </Text>
      );
    case 'list':
      return (
        <View role="list" style={styles.list} testID="md-list">
          {block.items.map((item, index) => (
            <View key={index} role="listitem" style={styles.listItem}>
              <Text variant="body" size="md" color={ink ?? color.muted} style={styles.bullet} aria-hidden>
                {block.ordered ? `${block.start + index}.` : '•'}
              </Text>
              <View style={styles.listBody}>
                <Text variant="body" size="md" selectable style={styles.paragraph} color={ink}>
                  <Spans spans={item.spans} ink={ink} />
                  {caret && index === block.items.length - 1 && item.children.length === 0 ? <Caret /> : null}
                </Text>
                {item.children.map((child, childIndex) => (
                  <Block key={childIndex} block={child} ink={ink} caret={caret && index === block.items.length - 1 && childIndex === item.children.length - 1} />
                ))}
              </View>
            </View>
          ))}
        </View>
      );
    case 'code':
      return <CodeBlock language={block.language} text={block.text} caret={caret} />;
    case 'quote':
      return (
        <View style={styles.quote} testID="md-quote">
          {block.blocks.map((child, index) => (
            <Block key={index} block={child} ink={ink ?? color.muted} caret={caret && index === block.blocks.length - 1} />
          ))}
        </View>
      );
    case 'table':
      return (
        <View style={styles.table} role="table" testID="md-table">
          <View style={[styles.tableRow, styles.tableHead]} role="row">
            {block.header.map((cell, index) => (
              <Text key={index} variant="title" size="sm" role="columnheader" selectable style={styles.cell}>
                <Spans spans={cell} ink={ink} />
              </Text>
            ))}
          </View>
          {block.rows.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.tableRow} role="row">
              {row.map((cell, index) => (
                <Text key={index} variant="body" size="sm" role="cell" selectable style={styles.cell} color={ink}>
                  <Spans spans={cell} ink={ink} />
                </Text>
              ))}
            </View>
          ))}
        </View>
      );
    case 'rule':
      return <View style={styles.rule} aria-hidden testID="md-rule" />;
  }
}

function Spans({ spans, ink }: { spans: readonly InlineSpan[]; ink?: string }): ReactNode {
  return spans.map((span, index) => {
    switch (span.kind) {
      case 'text':
        return span.text;
      case 'bold':
        return (
          <Text key={index} style={styles.bold} color={ink}>
            {span.text}
          </Text>
        );
      case 'italic':
        return (
          <Text key={index} style={styles.italic} color={ink}>
            {span.text}
          </Text>
        );
      case 'code':
        return (
          <Text key={index} variant="mono" style={styles.inlineCode} color={ink}>
            {span.text}
          </Text>
        );
      case 'link':
        return (
          <Text key={index} role="link" aria-label={span.text} color={tone.ado.text} style={styles.link} onPress={() => void Linking.openURL(span.href)} testID="md-link">
            {span.text}
          </Text>
        );
    }
  });
}

const TOKEN_INKS: Record<TokenKind, string> = {
  plain: color.ink,
  keyword: color.claudeText,
  string: tone.ok.text,
  comment: color.muted,
  number: tone.attention.text,
  tag: color.ado,
  added: tone.ok.text,
  removed: tone.danger.text,
  meta: color.muted,
};

/** How long Copy reads "Copied" before it goes back. */
const COPIED_MS = 1_500;

function CodeBlock({ language, text, caret }: { language: string | null; text: string; caret: boolean }) {
  const lines = highlight(text, languageOf(language));
  return (
    <View style={styles.code} testID="md-code">
      <View style={styles.codeBar}>
        <Text variant="mono" size="xs" color={color.muted}>
          {language ?? 'text'}
        </Text>
        <CopyButton text={text} label="Copy code" />
      </View>
      <View style={styles.codeBody}>
        {lines.map((tokens, index) => (
          <Text key={index} variant="mono" size="sm" selectable style={styles.codeLine}>
            {tokens.length === 0 ? ' ' : tokens.map((token, tokenIndex) => <Text key={tokenIndex} color={TOKEN_INKS[token.kind]}>{token.text}</Text>)}
            {caret && index === lines.length - 1 ? <Caret /> : null}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** A small Copy button: on a code block's bar, and on each message (AL-255). */
export function CopyButton({ text, label = 'Copy', testID }: { text: string; label?: string; testID?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), COPIED_MS);
    return () => clearTimeout(timer);
  }, [state]);
  const word = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label;
  return (
    <Pressable
      role="button"
      aria-label={label}
      onPress={() => void copyText(text).then((ok) => setState(ok ? 'copied' : 'failed'))}
      style={({ pressed }) => [styles.copy, pressed && styles.copyPressed]}
      testID={testID ?? 'md-copy'}
    >
      <Icon name={state === 'copied' ? 'check' : 'copy'} size={12} color={color.muted} />
      <Text variant="meta" size="xs">
        {word}
      </Text>
    </Pressable>
  );
}

/** The plain text of a Markdown block list, for Copy on a message. */
export function markdownPlainText(text: string): string {
  return parseMarkdown(text)
    .map((block) => {
      switch (block.kind) {
        case 'heading':
        case 'paragraph':
          return spansText(block.spans);
        case 'list':
          return block.items.map((item, index) => `${block.ordered ? `${block.start + index}.` : '-'} ${spansText(item.spans)}`).join('\n');
        case 'code':
          return block.text;
        case 'quote':
          return block.blocks.map((child) => (child.kind === 'paragraph' ? spansText(child.spans) : '')).join('\n');
        case 'table':
          return [block.header, ...block.rows].map((row) => row.map(spansText).join(' | ')).join('\n');
        case 'rule':
          return '---';
      }
    })
    .join('\n\n');
}

const styles = StyleSheet.create({
  blocks: {
    gap: space.sm,
  },
  heading: {
    marginTop: space.xs,
  },
  paragraph: {
    lineHeight: 22,
  },
  bold: {
    fontWeight: fontWeight.heading,
  },
  italic: {
    fontStyle: 'italic',
  },
  inlineCode: {
    fontSize: fontSize.sm + 1,
    backgroundColor: color.bg,
    borderRadius: 4,
  },
  link: {
    textDecorationLine: 'underline',
  },
  list: {
    gap: space.xs,
    paddingLeft: space.xs,
  },
  listItem: {
    flexDirection: 'row',
    gap: space.sm,
  },
  bullet: {
    minWidth: 18,
    textAlign: 'right',
    lineHeight: 22,
  },
  listBody: {
    flex: 1,
    gap: space.xs,
  },
  code: {
    borderRadius: radius.chip + 2,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.bg,
    overflow: 'hidden',
  },
  codeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: space.md,
    paddingRight: space.xs,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  codeBody: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  codeLine: {
    fontFamily: font.mono,
    lineHeight: 20,
  },
  copy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: 28,
    paddingHorizontal: space.sm,
    borderRadius: radius.chip - 2,
  },
  copyPressed: {
    backgroundColor: color.line,
  },
  quote: {
    gap: space.xs,
    paddingLeft: space.md,
    borderLeftWidth: 3,
    borderLeftColor: color.line,
  },
  table: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.chip,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  tableHead: {
    borderTopWidth: 0,
    backgroundColor: color.bg,
  },
  cell: {
    flex: 1,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  rule: {
    height: 1,
    backgroundColor: color.line,
    marginVertical: space.xs,
  },
});
