import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { color, font, fontSize, fontWeight, radius, space, tone } from '@agent-lanes/tokens';
import { Icon, Text } from '@agent-lanes/ui';
import { editDiff } from '../model/edit-diff';
import { toggleRowExpanded, useRowExpanded } from '../model/expanded';
import { OUTPUT_ROW_GAP } from '../model/virtual';
import { compactLabel, outputClock, statSpans, turnEndLabel, userCaption, type OutputRow, type StatSpan } from '../model/rows';
import { CopyButton, Markdown, markdownPlainText } from './Markdown';

/**
 * One row of the output stream (artboard 3 Output): a system line, a tool row with its coloured verb
 * chip, mono detail and stats, a paragraph of prose with bold names, or the line being written with
 * its caret. Text is selectable, so output can be copied.
 */
export function OutputRowView({ row, ticketId }: { row: OutputRow; ticketId: string }) {
  switch (row.type) {
    case 'system':
      return (
        <View style={styles.row} testID="output-system">
          <Text variant="meta" selectable>
            {`${outputClock(row.at)} · ${row.text}`}
          </Text>
        </View>
      );
    case 'failed':
      return (
        <View style={styles.row} testID="output-failed">
          <Text variant="meta" color={tone.danger.text} selectable>
            {row.text}
          </Text>
        </View>
      );
    case 'compact':
      return (
        <View style={[styles.row, styles.turnEnd]} testID="output-compact">
          <View style={styles.turnRule} aria-hidden />
          <Text variant="meta" color={color.claudeText} selectable>
            {`${outputClock(row.at)} · ${compactLabel(row)}`}
          </Text>
          <View style={styles.turnRule} aria-hidden />
        </View>
      );
    case 'turn-end':
      return (
        <View style={[styles.row, styles.turnEnd]} testID="output-turn-end">
          <View style={styles.turnRule} aria-hidden />
          <Text variant="meta" selectable>
            {turnEndLabel(row)}
          </Text>
          <View style={styles.turnRule} aria-hidden />
        </View>
      );
    case 'user':
      return (
        <View style={[styles.row, styles.userRow]} testID="output-user">
          <View style={[styles.bubble, row.source === 'skill' && styles.bubbleSkill]}>
            <Text variant="meta" size="xs" color={color.claudeText}>
              {userCaption(row)}
            </Text>
            <Text variant={row.source === 'skill' ? 'mono' : 'body'} size="md" selectable style={styles.prose}>
              {row.text}
            </Text>
          </View>
        </View>
      );
    case 'tool':
      return <ToolRow row={row} ticketId={ticketId} />;
    case 'prose':
      return <ProseRow text={row.text} />;
    case 'streaming':
      return row.live ? (
        <View style={styles.row} testID="output-streaming">
          <Markdown text={row.text.trimEnd()} streaming ink={color.claudeText} />
        </View>
      ) : (
        <ProseRow text={row.text} />
      );
  }
}

/** A finished message as Markdown (AL-255), with Copy for the whole message shown while the pointer is over it. */
function ProseRow({ text }: { text: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable role="group" aria-label="Agent message" focusable={false} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={styles.row} testID="output-prose">
      <Markdown text={text} />
      <View style={[styles.messageCopy, !hovered && styles.messageCopyHidden]} testID="output-prose-copy">
        <CopyButton text={markdownPlainText(text)} label="Copy message" testID="output-copy-message" />
      </View>
    </Pressable>
  );
}

/** How many lines of a failed call's reason show while the row is closed (AL-256). */
const ERROR_PREVIEW_LINES = 2;

/**
 * A tool call (AL-256): one line with its verb chip, detail and stats; a click, Enter or Space opens
 * it on the call's full input, an Edit's inline diff and what the tool returned. A failed call shows
 * the first lines of its reason even while closed. Open rows are remembered per ticket.
 */
function ToolRow({ row, ticketId }: { row: Extract<OutputRow, { type: 'tool' }>; ticketId: string }) {
  const spawn = row.tool === 'spawn';
  const chipTone = row.isError ? tone.danger : spawn ? tone.claude : tone.ado;
  const expanded = useRowExpanded(ticketId, row.key);
  const hasBody = row.input !== null || row.edit !== null || row.output !== null;
  const toggle = () => toggleRowExpanded(ticketId, row.key);
  return (
    <View style={styles.row} testID="output-tool">
      <View style={[styles.tool, spawn && styles.toolSpawn, row.isError && styles.toolError, expanded && styles.toolOpen]}>
        <Pressable
          role="button"
          aria-expanded={expanded}
          aria-label={`${row.label} ${row.detail}`.trim()}
          disabled={!hasBody}
          onPress={toggle}
          style={styles.toolHead}
          testID="output-tool-toggle"
        >
          <View style={[styles.chip, { backgroundColor: chipTone.band }]}>
            <Text variant="mono" color={chipTone.text} style={styles.chipLabel} numberOfLines={1}>
              {row.label}
            </Text>
          </View>
          <Text variant="mono" selectable numberOfLines={1} style={styles.detail}>
            {row.detail}
            {row.stats ? '  ' : null}
            {row.stats ? statSpans(row.stats).map((span, index) => <Stat key={index} span={span} />) : null}
          </Text>
          {hasBody ? <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={color.muted} /> : null}
        </Pressable>
        {row.isError && row.output && !expanded ? (
          <Text variant="mono" size="xs" color={tone.danger.text} numberOfLines={ERROR_PREVIEW_LINES} selectable style={styles.toolErrorPreview} testID="output-tool-error">
            {row.output}
          </Text>
        ) : null}
        {expanded ? <ToolBody row={row} /> : null}
      </View>
    </View>
  );
}

function ToolBody({ row }: { row: Extract<OutputRow, { type: 'tool' }> }) {
  return (
    <View style={styles.toolBody} testID="output-tool-body">
      {row.input !== null ? <ToolSection title="Input" text={row.input} /> : null}
      {row.edit ? <EditDiff before={row.edit.before} after={row.edit.after} /> : null}
      {row.output !== null ? <ToolSection title={row.isError ? 'Error' : 'Output'} text={row.output} danger={row.isError} /> : null}
    </View>
  );
}

function ToolSection({ title, text, danger = false }: { title: string; text: string; danger?: boolean }) {
  return (
    <View style={styles.toolSection}>
      <View style={styles.toolSectionBar}>
        <Text variant="meta" size="xs" color={danger ? tone.danger.text : color.muted}>
          {title}
        </Text>
        <CopyButton text={text} label={`Copy ${title.toLowerCase()}`} testID={`output-copy-${title.toLowerCase()}`} />
      </View>
      <ScrollView style={styles.toolScroll} nestedScrollEnabled>
        <Text variant="mono" size="sm" selectable color={danger ? tone.danger.text : color.ink} style={styles.toolText}>
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}

const DIFF_INKS = { context: color.muted, added: tone.ok.text, removed: tone.danger.text } as const;
const DIFF_MARKS = { context: ' ', added: '+', removed: '−' } as const;

/** An Edit's old and new text as a line diff (AL-256). */
function EditDiff({ before, after }: { before: string; after: string }) {
  const lines = editDiff(before, after);
  return (
    <View style={styles.toolSection} testID="output-tool-diff">
      <View style={styles.toolSectionBar}>
        <Text variant="meta" size="xs" color={color.muted}>
          Change
        </Text>
        <CopyButton text={after} label="Copy new text" testID="output-copy-change" />
      </View>
      <ScrollView style={styles.toolScroll} nestedScrollEnabled>
        {lines.map((line, index) => (
          <Text key={index} variant="mono" size="sm" selectable color={DIFF_INKS[line.kind]} style={[styles.toolText, line.kind !== 'context' && styles.diffLine, line.kind === 'added' && styles.diffAdded, line.kind === 'removed' && styles.diffRemoved]}>
            {`${DIFF_MARKS[line.kind]} ${line.text}`}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const STAT_INKS: Record<StatSpan['tone'], string> = {
  added: tone.ok.text,
  removed: tone.danger.text,
  ok: tone.ok.text,
  error: tone.danger.text,
  plain: color.muted,
};

function Stat({ span }: { span: StatSpan }) {
  return <Text color={STAT_INKS[span.tone]}>{` ${span.text}`}</Text>;
}

const styles = StyleSheet.create({
  row: {
    paddingBottom: OUTPUT_ROW_GAP,
  },
  prose: {
    lineHeight: 22,
  },
  // The user's messages sit on the right in a violet-tinted bubble, as a chat shows them (AL-251).
  userRow: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '80%',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.card,
    borderBottomRightRadius: radius.chip - 2,
    backgroundColor: tone.claude.wash,
    borderWidth: 1,
    borderColor: tone.claude.band,
  },
  bubbleSkill: {
    backgroundColor: color.bg,
    borderColor: color.line,
  },
  turnEnd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.xs,
  },
  turnRule: {
    flex: 1,
    height: 1,
    backgroundColor: color.line,
  },
  // Copy for a whole message sits at its top right and shows on hover (AL-255).
  messageCopy: {
    position: 'absolute',
    top: -space.xs,
    right: 0,
    borderRadius: radius.chip - 2,
    backgroundColor: color.surface,
  },
  messageCopyHidden: {
    opacity: 0,
  },
  tool: {
    borderRadius: radius.chip + 2,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.bg,
  },
  toolHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 38,
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
  },
  toolOpen: {
    borderColor: tone.ado.band,
  },
  toolErrorPreview: {
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
  },
  toolBody: {
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingBottom: space.md,
  },
  toolSection: {
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    overflow: 'hidden',
  },
  toolSectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: space.md,
    paddingRight: space.xs,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  toolScroll: {
    maxHeight: 320,
  },
  toolText: {
    paddingHorizontal: space.md,
    paddingVertical: 2,
    lineHeight: 20,
  },
  diffLine: {
    paddingHorizontal: space.md,
  },
  diffAdded: {
    backgroundColor: tone.ok.wash,
  },
  diffRemoved: {
    backgroundColor: tone.danger.wash,
  },
  toolSpawn: {
    backgroundColor: tone.claude.wash,
    borderColor: tone.claude.band,
  },
  toolError: {
    backgroundColor: tone.danger.wash,
    borderColor: tone.danger.border,
  },
  chip: {
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.chip - 2,
  },
  chipLabel: {
    fontFamily: font.mono,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.heading,
  },
  detail: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: fontSize.sm + 1,
  },
});
