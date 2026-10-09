import { StyleSheet, View } from 'react-native';
import { color, font, fontSize, fontWeight, radius, space, tone } from '@agent-lanes/tokens';
import { Text } from '@agent-lanes/ui';
import { OUTPUT_ROW_GAP } from '../model/virtual';
import { outputClock, proseSpans, statSpans, turnEndLabel, userCaption, type OutputRow, type StatSpan } from '../model/rows';

/**
 * One row of the output stream (artboard 3 Output): a system line, a tool row with its coloured verb
 * chip, mono detail and stats, a paragraph of prose with bold names, or the line being written with
 * its caret. Text is selectable, so output can be copied.
 */
export function OutputRowView({ row }: { row: OutputRow }) {
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
      return <ToolRow row={row} />;
    case 'prose':
      return (
        <View style={styles.row} testID="output-prose">
          <Prose text={row.text} />
        </View>
      );
    case 'streaming':
      return (
        <View style={styles.row} testID={row.live ? 'output-streaming' : 'output-prose'}>
          {row.live ? (
            <Text variant="body" size="md" color={color.claudeText} selectable style={styles.prose}>
              {row.text.trimEnd()}
              <Text color={color.claude} aria-hidden testID="output-caret">
                ▍
              </Text>
            </Text>
          ) : (
            <Prose text={row.text} />
          )}
        </View>
      );
  }
}

function Prose({ text }: { text: string }) {
  return (
    <Text variant="body" size="md" selectable style={styles.prose}>
      {proseSpans(text).map((span, index) =>
        span.style === 'plain' ? (
          span.text
        ) : (
          <Text key={index} variant={span.style === 'code' ? 'mono' : undefined} style={span.style === 'bold' ? styles.bold : undefined}>
            {span.text}
          </Text>
        ),
      )}
    </Text>
  );
}

function ToolRow({ row }: { row: Extract<OutputRow, { type: 'tool' }> }) {
  const spawn = row.tool === 'spawn';
  const chipTone = row.isError ? tone.danger : spawn ? tone.claude : tone.ado;
  return (
    <View style={styles.row} testID="output-tool">
      <View style={[styles.tool, spawn && styles.toolSpawn, row.isError && styles.toolError]}>
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
      </View>
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
  bold: {
    fontWeight: fontWeight.heading,
  },
  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 38,
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
    borderRadius: radius.chip + 2,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.bg,
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
