import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { DiffAgainst, DiffFile, TicketSubBranch } from '@agent-lanes/contracts';
import { color, minTarget, radius, space, tone } from '@agent-lanes/tokens';
import { Button, Icon, Pill, SegmentedControl, Text } from '@agent-lanes/ui';
import { useDiffFile, useTicketDiff } from '@/shared/api';
import { diffStats, diffStatus, fileCount, formatBytes, parseUnifiedDiff, type DiffLine } from '../lib/diff-lines';

/** Lines of one file drawn at first; "Show more" adds this many again, so a long file never blocks a frame. */
export const DIFF_LINES_PAGE = 400;

const BASE = 'base';

export interface DiffTabProps {
  ticketId: string;
  /** The ticket branch, for the sub-branch comparison's label. */
  branch: string;
  /** Writer sub-agents' branches; unmerged ones can be compared with the ticket branch. */
  subBranches: readonly TicketSubBranch[];
}

/**
 * The drill-in's Diff tab (AL-179, artboard 3 tabs): the files the ticket branch changed against its
 * base, or one sub-branch against the ticket branch, with their stats; each file's unified diff is
 * fetched only when its row is opened (`git:diffFile`, AL-089), so a large change set costs one
 * small list until the user looks at a file.
 */
export function DiffTab({ ticketId, branch, subBranches }: DiffTabProps) {
  const [compare, setCompare] = useState<string>(BASE);
  const open = useMemo(() => subBranches.filter((sub) => sub.mergedAt === null), [subBranches]);
  const selected = compare === BASE || !open.some((sub) => sub.branch === compare) ? BASE : compare;
  const against: DiffAgainst = selected === BASE ? { kind: 'base' } : { kind: 'sub-branch', branch: selected };
  const diff = useTicketDiff(ticketId, against);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <View style={styles.tab} testID="ticket-tab-diff">
      <View style={styles.toolbar}>
        {open.length > 0 ? (
          <SegmentedControl
            label="Compare"
            variant="pills"
            options={[
              { value: BASE, label: 'Ticket branch vs base' },
              ...open.map((sub) => ({ value: sub.branch, label: sub.branch, accessibilityLabel: `${sub.branch} vs ${branch}` })),
            ]}
            value={selected}
            onChange={(value) => {
              setCompare(value);
              setExpanded(new Set());
            }}
            testID="diff-compare"
          />
        ) : (
          <Text variant="title">Ticket branch vs base</Text>
        )}
        <Button
          label="Refresh"
          icon="refresh"
          size="sm"
          onPress={() => void diff.refetch()}
          loading={diff.isFetching && !diff.isPending}
          testID="diff-refresh"
        />
      </View>

      {diff.isPending ? (
        <Text variant="meta" size="md" aria-busy testID="diff-loading">
          Loading the changes…
        </Text>
      ) : diff.isError ? (
        <View style={styles.message}>
          <Text variant="meta" size="md" color={tone.danger.text} testID="diff-error">
            {`Couldn't load the diff. ${diff.error.message}`}
          </Text>
          <Button label="Retry" size="sm" onPress={() => void diff.refetch()} style={styles.start} />
        </View>
      ) : (
        <>
          <View style={styles.summary}>
            <Text variant="mono" color={color.muted} numberOfLines={1} selectable testID="diff-refs">
              {`${diff.data.toRef} vs ${diff.data.fromRef} @ ${diff.data.fromCommit.slice(0, 7)}`}
            </Text>
            <Text variant="meta" size="md" testID="diff-totals">
              {`${fileCount(diff.data.totals.files)} · +${diff.data.totals.additions} −${diff.data.totals.deletions}`}
            </Text>
            {diff.data.includesUncommitted ? <Pill label="Includes uncommitted changes" tone="attention" /> : null}
          </View>
          {diff.data.files.length === 0 ? (
            <Text variant="meta" size="md" testID="diff-empty">
              {against.kind === 'base' ? 'No changes against the base yet.' : `Nothing on ${selected} that ${branch} doesn't have.`}
            </Text>
          ) : (
            <View style={styles.files} role="list" aria-label="Changed files">
              {diff.data.files.map((file) => (
                <DiffFileRow
                  key={`${file.oldPath ?? ''}>${file.path}`}
                  ticketId={ticketId}
                  against={against}
                  file={file}
                  expanded={expanded.has(file.path)}
                  onToggle={() => toggle(file.path)}
                />
              ))}
            </View>
          )}
          {diff.data.truncated ? (
            <Text variant="meta" size="md" testID="diff-truncated">
              {`Showing the first ${fileCount(diff.data.files.length)} of ${diff.data.totals.files}.`}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

interface DiffFileRowProps {
  ticketId: string;
  against: DiffAgainst;
  file: DiffFile;
  expanded: boolean;
  onToggle(): void;
}

function DiffFileRow({ ticketId, against, file, expanded, onToggle }: DiffFileRowProps) {
  const status = diffStatus(file.status);
  const name = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
  return (
    <View style={styles.file} role="listitem" testID="diff-file">
      <Pressable
        role="button"
        aria-expanded={expanded}
        aria-label={`${name}, ${status.word.toLowerCase()}, ${diffStats(file)}`}
        onPress={onToggle}
        style={styles.fileHeader}
        testID={`diff-file-${file.path}`}
      >
        <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={16} color={color.muted} />
        <View style={[styles.status, statusTone(file)]} aria-hidden>
          <Text variant="mono" size="xs" color={statusText(file)}>
            {status.letter}
          </Text>
        </View>
        <Text variant="mono" numberOfLines={1} style={styles.path}>
          {name}
        </Text>
        {file.binary || file.additions === null ? (
          <Text variant="mono" color={color.muted}>
            binary
          </Text>
        ) : (
          <Text variant="mono">
            <Text variant="mono" color={tone.ok.text}>{`+${file.additions}`}</Text>{' '}
            <Text variant="mono" color={tone.danger.text}>{`−${file.deletions ?? 0}`}</Text>
          </Text>
        )}
      </Pressable>
      {expanded ? <FileDiff ticketId={ticketId} against={against} file={file} /> : null}
    </View>
  );
}

function statusTone(file: DiffFile) {
  if (file.status === 'added' || file.status === 'untracked') return styles.statusAdded;
  if (file.status === 'deleted') return styles.statusDeleted;
  return styles.statusChanged;
}

function statusText(file: DiffFile): string {
  if (file.status === 'added' || file.status === 'untracked') return tone.ok.text;
  if (file.status === 'deleted') return tone.danger.text;
  return tone.neutral.text;
}

/** One opened file: fetched on open, drawn DIFF_LINES_PAGE lines at a time. */
function FileDiff({ ticketId, against, file }: { ticketId: string; against: DiffAgainst; file: DiffFile }) {
  const query = useDiffFile(ticketId, against, file);
  const [shown, setShown] = useState(DIFF_LINES_PAGE);
  const lines = useMemo(() => (query.data?.kind === 'text' ? parseUnifiedDiff(query.data.patch) : []), [query.data]);

  if (query.isPending) {
    return (
      <Text variant="meta" size="md" style={styles.fileNote} testID="diff-file-loading">
        Loading the diff…
      </Text>
    );
  }
  if (query.isError) {
    return (
      <View style={[styles.fileNote, styles.message]}>
        <Text variant="meta" size="md" color={tone.danger.text}>
          {`Couldn't load this file's diff. ${query.error.message}`}
        </Text>
        <Button label="Retry" size="sm" onPress={() => void query.refetch()} style={styles.start} />
      </View>
    );
  }
  if (query.data.kind === 'binary') {
    return (
      <Text variant="meta" size="md" style={styles.fileNote} testID="diff-file-binary">
        Binary file not shown.
      </Text>
    );
  }
  if (query.data.kind === 'too-large') {
    const size = query.data.bytes === null ? '' : ` (${formatBytes(query.data.bytes)})`;
    return (
      <Text variant="meta" size="md" style={styles.fileNote} testID="diff-file-too-large">
        {`Diff too large to show${size}. Open the file in your editor to see it.`}
      </Text>
    );
  }
  if (lines.length === 0) {
    return (
      <Text variant="meta" size="md" style={styles.fileNote}>
        No line changes (mode or rename only).
      </Text>
    );
  }

  const remaining = lines.length - shown;
  return (
    <View style={styles.lines} testID="diff-file-lines">
      {lines.slice(0, shown).map((line, index) => (
        <DiffLineRow key={index} line={line} />
      ))}
      {remaining > 0 ? (
        <Button
          label={`Show ${Math.min(remaining, DIFF_LINES_PAGE)} more of ${remaining} lines`}
          size="sm"
          variant="soft"
          onPress={() => setShown((count) => count + DIFF_LINES_PAGE)}
          style={styles.more}
          testID="diff-show-more"
        />
      ) : null}
    </View>
  );
}

function DiffLineRow({ line }: { line: DiffLine }) {
  if (line.kind === 'hunk' || line.kind === 'note') {
    return (
      <View style={[styles.line, styles.lineHunk]} testID={`diff-line-${line.kind}`}>
        <Text variant="mono" color={color.claudeText} selectable numberOfLines={1} style={styles.code}>
          {line.text}
        </Text>
      </View>
    );
  }
  const sign = line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' ';
  return (
    <View
      style={[styles.line, line.kind === 'add' ? styles.lineAdd : line.kind === 'remove' ? styles.lineRemove : null]}
      testID={`diff-line-${line.kind}`}
    >
      <Text variant="mono" size="xs" color={color.muted} selectable={false} style={styles.number} aria-hidden>
        {line.oldLine ?? ''}
      </Text>
      <Text variant="mono" size="xs" color={color.muted} selectable={false} style={styles.number} aria-hidden>
        {line.newLine ?? ''}
      </Text>
      <Text
        variant="mono"
        color={line.kind === 'add' ? tone.ok.text : line.kind === 'remove' ? tone.danger.text : color.muted}
        style={styles.sign}
        aria-label={line.kind === 'add' ? 'added' : line.kind === 'remove' ? 'removed' : undefined}
      >
        {sign}
      </Text>
      <Text variant="mono" selectable style={styles.code}>
        {line.text}
      </Text>
    </View>
  );
}

const NUMBER_WIDTH = 44;

const styles = StyleSheet.create({
  tab: {
    gap: space.lg,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.md,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.md,
  },
  message: {
    gap: space.sm,
  },
  start: {
    alignSelf: 'flex-start',
  },
  files: {
    gap: space.sm,
  },
  // The output stream's tool-row look (artboard 3): a light ruled card per file.
  file: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.control,
    backgroundColor: color.surface,
    overflow: 'hidden',
  },
  fileHeader: {
    minHeight: minTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    backgroundColor: tone.neutral.band,
  },
  status: {
    width: 20,
    height: 20,
    borderRadius: radius.chip / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusAdded: {
    backgroundColor: tone.ok.band,
  },
  statusDeleted: {
    backgroundColor: tone.danger.band,
  },
  statusChanged: {
    backgroundColor: color.surface,
  },
  path: {
    flex: 1,
    minWidth: 0,
  },
  fileNote: {
    padding: space.md,
  },
  lines: {
    paddingVertical: space.xs,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: space.sm,
  },
  lineAdd: {
    backgroundColor: tone.ok.wash,
  },
  lineRemove: {
    backgroundColor: tone.danger.wash,
  },
  lineHunk: {
    backgroundColor: tone.claude.wash,
    paddingVertical: 2,
  },
  number: {
    width: NUMBER_WIDTH,
    textAlign: 'right',
    paddingRight: space.sm,
  },
  sign: {
    width: space.lg,
    textAlign: 'center',
  },
  // Long lines wrap (react-native-web text keeps its spaces) rather than scrolling sideways.
  code: {
    flex: 1,
    minWidth: 0,
  },
  more: {
    alignSelf: 'flex-start',
    margin: space.sm,
  },
});
