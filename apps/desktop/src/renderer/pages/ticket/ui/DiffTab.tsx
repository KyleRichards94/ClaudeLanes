import { useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type {
  DiffAgainst,
  DiffFile,
  TicketSubBranch,
} from "@agent-lanes/contracts";
import { color, minTarget, radius, space, tone } from "@agent-lanes/tokens";
import { Button, Icon, Pill, SegmentedControl, Text } from "@agent-lanes/ui";
import { useDiffFile, useTicketDiff } from "@/shared/api";
import type { DiffView } from "@/shared/model";
import {
  diffStats,
  diffStatus,
  fileCount,
  formatBytes,
  parseUnifiedDiff,
  toSplitRows,
  type DiffLine,
} from "../lib/diff-lines";

/** Lines of one file drawn at first; "Show more" adds this many again, so a long file never blocks a frame. */
export const DIFF_LINES_PAGE = 400;

const BASE = "base";

/** Files opened without being asked, top first; the rest wait for a click so a huge change set loads lazily. */
export const AUTO_EXPAND_FILES = 40;

const VIEW_OPTIONS = [
  { value: "unified" as const, label: "Unified" },
  { value: "split" as const, label: "Side by side" },
];

export interface DiffTabProps {
  ticketId: string;
  /** The ticket branch, for the sub-branch comparison's label. */
  branch: string;
  /** Writer sub-agents' branches; unmerged ones can be compared with the ticket branch. */
  subBranches: readonly TicketSubBranch[];
  /** Unified, or old and new side by side. */
  view?: DiffView;
  onViewChange?(view: DiffView): void;
  /** Files the agent edited a moment ago (path → when): marked, and always opened. */
  recent?: ReadonlyMap<string, number>;
  /** More controls for the toolbar (the Output & diff view's Follow agent). */
  toolbarExtra?: ReactNode;
  /** Where each file's row sits in the pane, so the pane can scroll to the one the agent is editing. */
  onFileLayout?(path: string, y: number): void;
}

/**
 * The drill-in's Diff tab (AL-179, artboard 3 tabs): the files the ticket branch changed against its
 * base, or one sub-branch against the ticket branch, with their stats; each file's unified diff is
 * fetched only when its row is opened (`git:diffFile`, AL-089), so a large change set costs one
 * small list until the user looks at a file. Files open expanded (the first AUTO_EXPAND_FILES, and any
 * the agent just edited), unified or side by side.
 */
export function DiffTab({
  ticketId,
  branch,
  subBranches,
  view = "unified",
  onViewChange,
  recent,
  toolbarExtra,
  onFileLayout,
}: DiffTabProps) {
  const [compare, setCompare] = useState<string>(BASE);
  const open = useMemo(
    () => subBranches.filter((sub) => sub.mergedAt === null),
    [subBranches],
  );
  const selected =
    compare === BASE || !open.some((sub) => sub.branch === compare)
      ? BASE
      : compare;
  const against: DiffAgainst =
    selected === BASE
      ? { kind: "base" }
      : { kind: "sub-branch", branch: selected };
  const diff = useTicketDiff(ticketId, against);
  // What the user opened or closed themselves; every other file follows the default.
  const [chosen, setChosen] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const isExpanded = (path: string, index: number) =>
    chosen.get(path) ??
    (index < AUTO_EXPAND_FILES || (recent?.has(path) ?? false));
  const toggle = (path: string, index: number) =>
    setChosen((current) =>
      new Map(current).set(path, !isExpanded(path, index)),
    );
  const setAll = (open: boolean) =>
    setChosen(
      new Map((diff.data?.files ?? []).map((file) => [file.path, open])),
    );

  return (
    <View style={styles.tab} testID="ticket-tab-diff">
      <View style={styles.toolbar}>
        {open.length > 0 ? (
          <SegmentedControl
            label="Compare"
            variant="pills"
            options={[
              { value: BASE, label: "Ticket branch vs base" },
              ...open.map((sub) => ({
                value: sub.branch,
                label: sub.branch,
                accessibilityLabel: `${sub.branch} vs ${branch}`,
              })),
            ]}
            value={selected}
            onChange={(value) => {
              setCompare(value);
              setChosen(new Map());
            }}
            testID="diff-compare"
          />
        ) : (
          <Text variant="title">Ticket branch vs base</Text>
        )}
        <View style={styles.toolbarActions}>
          {toolbarExtra}
          <SegmentedControl
            label="Diff view"
            options={VIEW_OPTIONS}
            value={view}
            onChange={(next) => onViewChange?.(next)}
            testID="diff-view"
          />
          <Button
            label="Expand all"
            size="sm"
            variant="soft"
            onPress={() => setAll(true)}
            testID="diff-expand-all"
          />
          <Button
            label="Collapse all"
            size="sm"
            variant="soft"
            onPress={() => setAll(false)}
            testID="diff-collapse-all"
          />
          <Button
            label="Refresh"
            icon="refresh"
            size="sm"
            onPress={() => void diff.refetch()}
            loading={diff.isFetching && !diff.isPending}
            testID="diff-refresh"
          />
        </View>
      </View>

      {diff.isPending ? (
        <Text variant="meta" size="md" aria-busy testID="diff-loading">
          Loading the changes…
        </Text>
      ) : diff.isError ? (
        <View style={styles.message}>
          <Text
            variant="meta"
            size="md"
            color={tone.danger.text}
            testID="diff-error"
          >
            {`Couldn't load the diff. ${diff.error.message}`}
          </Text>
          <Button
            label="Retry"
            size="sm"
            onPress={() => void diff.refetch()}
            style={styles.start}
          />
        </View>
      ) : (
        <>
          <View style={styles.summary}>
            <Text
              variant="mono"
              color={color.muted}
              numberOfLines={1}
              selectable
              testID="diff-refs"
            >
              {`${diff.data.toRef} vs ${diff.data.fromRef} @ ${diff.data.fromCommit.slice(0, 7)}`}
            </Text>
            <Text variant="meta" size="md" testID="diff-totals">
              {`${fileCount(diff.data.totals.files)} · +${diff.data.totals.additions} −${diff.data.totals.deletions}`}
            </Text>
            {diff.data.includesUncommitted ? (
              <Pill label="Includes uncommitted changes" tone="attention" />
            ) : null}
          </View>
          {diff.data.files.length === 0 ? (
            <Text variant="meta" size="md" testID="diff-empty">
              {against.kind === "base"
                ? "No changes against the base yet."
                : `Nothing on ${selected} that ${branch} doesn't have.`}
            </Text>
          ) : (
            <View style={styles.files} role="list" aria-label="Changed files">
              {diff.data.files.map((file, index) => (
                <DiffFileRow
                  key={`${file.oldPath ?? ""}>${file.path}`}
                  ticketId={ticketId}
                  against={against}
                  file={file}
                  view={view}
                  recent={recent?.has(file.path) ?? false}
                  expanded={isExpanded(file.path, index)}
                  onToggle={() => toggle(file.path, index)}
                  onLayout={
                    onFileLayout ? (y) => onFileLayout(file.path, y) : undefined
                  }
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
  view: DiffView;
  /** The agent edited it a moment ago. */
  recent: boolean;
  expanded: boolean;
  onToggle(): void;
  onLayout: ((y: number) => void) | undefined;
}

function DiffFileRow({
  ticketId,
  against,
  file,
  view,
  recent,
  expanded,
  onToggle,
  onLayout,
}: DiffFileRowProps) {
  const status = diffStatus(file.status);
  const name = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
  return (
    <View
      style={[styles.file, recent && styles.fileRecent]}
      role="listitem"
      testID="diff-file"
      onLayout={
        onLayout ? (event) => onLayout(event.nativeEvent.layout.y) : undefined
      }
    >
      <Pressable
        role="button"
        aria-expanded={expanded}
        aria-label={`${name}, ${status.word.toLowerCase()}, ${diffStats(file)}`}
        onPress={onToggle}
        style={styles.fileHeader}
        testID={`diff-file-${file.path}`}
      >
        <Icon
          name={expanded ? "chevron-down" : "chevron-right"}
          size={16}
          color={color.muted}
        />
        <View style={[styles.status, statusTone(file)]} aria-hidden>
          <Text variant="mono" size="xs" color={statusText(file)}>
            {status.letter}
          </Text>
        </View>
        <Text variant="mono" numberOfLines={1} style={styles.path}>
          {name}
        </Text>
        {recent ? (
          <Pill
            label="Changed just now"
            tone="claude"
            testID={`diff-file-${file.path}-recent`}
          />
        ) : null}
        {file.binary || file.additions === null ? (
          <Text variant="mono" color={color.muted}>
            binary
          </Text>
        ) : (
          <Text variant="mono">
            <Text
              variant="mono"
              color={tone.ok.text}
            >{`+${file.additions}`}</Text>{" "}
            <Text
              variant="mono"
              color={tone.danger.text}
            >{`−${file.deletions ?? 0}`}</Text>
          </Text>
        )}
      </Pressable>
      {expanded ? (
        <FileDiff
          ticketId={ticketId}
          against={against}
          file={file}
          view={view}
        />
      ) : null}
    </View>
  );
}

function statusTone(file: DiffFile) {
  if (file.status === "added" || file.status === "untracked")
    return styles.statusAdded;
  if (file.status === "deleted") return styles.statusDeleted;
  return styles.statusChanged;
}

function statusText(file: DiffFile): string {
  if (file.status === "added" || file.status === "untracked")
    return tone.ok.text;
  if (file.status === "deleted") return tone.danger.text;
  return tone.neutral.text;
}

/** One opened file: fetched on open, drawn DIFF_LINES_PAGE lines at a time. */
function FileDiff({
  ticketId,
  against,
  file,
  view,
}: {
  ticketId: string;
  against: DiffAgainst;
  file: DiffFile;
  view: DiffView;
}) {
  const query = useDiffFile(ticketId, against, file);
  const [shown, setShown] = useState(DIFF_LINES_PAGE);
  const lines = useMemo(
    () =>
      query.data?.kind === "text" ? parseUnifiedDiff(query.data.patch) : [],
    [query.data],
  );
  const rows = useMemo(
    () => (view === "split" ? toSplitRows(lines) : []),
    [lines, view],
  );

  if (query.isPending) {
    return (
      <Text
        variant="meta"
        size="md"
        style={styles.fileNote}
        testID="diff-file-loading"
      >
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
        <Button
          label="Retry"
          size="sm"
          onPress={() => void query.refetch()}
          style={styles.start}
        />
      </View>
    );
  }
  if (query.data.kind === "binary") {
    return (
      <Text
        variant="meta"
        size="md"
        style={styles.fileNote}
        testID="diff-file-binary"
      >
        Binary file not shown.
      </Text>
    );
  }
  if (query.data.kind === "too-large") {
    const size =
      query.data.bytes === null ? "" : ` (${formatBytes(query.data.bytes)})`;
    return (
      <Text
        variant="meta"
        size="md"
        style={styles.fileNote}
        testID="diff-file-too-large"
      >
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

  const total = view === "split" ? rows.length : lines.length;
  const remaining = total - shown;
  return (
    <View style={styles.lines} testID="diff-file-lines">
      {view === "split"
        ? rows
            .slice(0, shown)
            .map((row, index) =>
              row.kind === "full" ? (
                <DiffLineRow key={index} line={row.line} />
              ) : (
                <SplitLineRow key={index} left={row.left} right={row.right} />
              ),
            )
        : lines
            .slice(0, shown)
            .map((line, index) => <DiffLineRow key={index} line={line} />)}
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

/** One side-by-side row: the old file's line on the left, the new file's on the right; blank where a side has none. */
function SplitLineRow({
  left,
  right,
}: {
  left: DiffLine | null;
  right: DiffLine | null;
}) {
  return (
    <View style={styles.splitRow} testID="diff-split-row">
      <SplitHalf line={left} side="old" />
      <View style={styles.splitGutter} aria-hidden />
      <SplitHalf line={right} side="new" />
    </View>
  );
}

function SplitHalf({
  line,
  side,
}: {
  line: DiffLine | null;
  side: "old" | "new";
}) {
  if (!line)
    return (
      <View
        style={[styles.splitHalf, styles.splitEmpty]}
        testID={`diff-split-${side}-empty`}
      />
    );
  const changed = line.kind === "add" || line.kind === "remove";
  return (
    <View
      style={[
        styles.splitHalf,
        line.kind === "add"
          ? styles.lineAdd
          : line.kind === "remove"
            ? styles.lineRemove
            : null,
      ]}
      testID={`diff-split-${side}-${line.kind}`}
    >
      <Text
        variant="mono"
        size="xs"
        color={color.muted}
        selectable={false}
        style={styles.number}
        aria-hidden
      >
        {(side === "old" ? line.oldLine : line.newLine) ?? ""}
      </Text>
      <Text
        variant="mono"
        selectable
        color={
          changed
            ? line.kind === "add"
              ? tone.ok.text
              : tone.danger.text
            : undefined
        }
        aria-label={
          line.kind === "add"
            ? "added"
            : line.kind === "remove"
              ? "removed"
              : undefined
        }
        style={styles.code}
      >
        {line.text}
      </Text>
    </View>
  );
}

function DiffLineRow({ line }: { line: DiffLine }) {
  if (line.kind === "hunk" || line.kind === "note") {
    return (
      <View
        style={[styles.line, styles.lineHunk]}
        testID={`diff-line-${line.kind}`}
      >
        <Text
          variant="mono"
          color={color.claudeText}
          selectable
          numberOfLines={1}
          style={styles.code}
        >
          {line.text}
        </Text>
      </View>
    );
  }
  const sign = line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " ";
  return (
    <View
      style={[
        styles.line,
        line.kind === "add"
          ? styles.lineAdd
          : line.kind === "remove"
            ? styles.lineRemove
            : null,
      ]}
      testID={`diff-line-${line.kind}`}
    >
      <Text
        variant="mono"
        size="xs"
        color={color.muted}
        selectable={false}
        style={styles.number}
        aria-hidden
      >
        {line.oldLine ?? ""}
      </Text>
      <Text
        variant="mono"
        size="xs"
        color={color.muted}
        selectable={false}
        style={styles.number}
        aria-hidden
      >
        {line.newLine ?? ""}
      </Text>
      <Text
        variant="mono"
        color={
          line.kind === "add"
            ? tone.ok.text
            : line.kind === "remove"
              ? tone.danger.text
              : color.muted
        }
        style={styles.sign}
        aria-label={
          line.kind === "add"
            ? "added"
            : line.kind === "remove"
              ? "removed"
              : undefined
        }
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
  toolbarActions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.sm,
  },
  fileRecent: {
    borderColor: tone.claude.border,
  },
  splitRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  splitHalf: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: space.sm,
  },
  splitEmpty: {
    backgroundColor: tone.neutral.band,
  },
  splitGutter: {
    width: 1,
    backgroundColor: color.line,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: space.md,
  },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.md,
  },
  message: {
    gap: space.sm,
  },
  start: {
    alignSelf: "flex-start",
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
    overflow: "hidden",
  },
  fileHeader: {
    minHeight: minTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
    backgroundColor: tone.neutral.band,
  },
  status: {
    width: 20,
    height: 20,
    borderRadius: radius.chip / 2,
    alignItems: "center",
    justifyContent: "center",
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
    flexDirection: "row",
    alignItems: "flex-start",
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
    textAlign: "right",
    paddingRight: space.sm,
  },
  sign: {
    width: space.lg,
    textAlign: "center",
  },
  // Long lines wrap (react-native-web text keeps its spaces) rather than scrolling sideways.
  code: {
    flex: 1,
    minWidth: 0,
  },
  more: {
    alignSelf: "flex-start",
    margin: space.sm,
  },
});
