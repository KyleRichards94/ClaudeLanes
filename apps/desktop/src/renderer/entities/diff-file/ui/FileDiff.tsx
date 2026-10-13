import { useMemo, useState } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import type { DiffAgainst } from "@agent-lanes/contracts";
import { color, space, tone } from "@agent-lanes/tokens";
import { Button, SegmentedControl, Text } from "@agent-lanes/ui";
import { useDiffFile } from "@/shared/api";
import type { DiffView } from "@/shared/model";
import {
  formatBytes,
  parseUnifiedDiff,
  toSplitRows,
  type DiffLine,
} from "../lib/diff-lines";

/** Lines of one file drawn at first; "Show more" adds this many again, so a long file never blocks a frame. */
export const DIFF_LINES_PAGE = 400;

/** The width of the author stripe on a changed line (handoff "Flight deck > Diff column"). */
export const AUTHOR_STRIPE_WIDTH = 4;

const BASE: DiffAgainst = { kind: "base" };

const VIEW_OPTIONS = [
  { value: "unified" as const, label: "Unified" },
  { value: "split" as const, label: "Side by side" },
];

export interface FileDiffProps {
  ticketId: string;
  /** The file's worktree-relative path. */
  path: string;
  /** Where a renamed file came from. */
  oldPath?: string | null;
  view: DiffView;
  /** Shows a small Unified / Side by side switch above the lines (a layout with no toolbar of its own). */
  onViewChange?(view: DiffView): void;
  /** The author's colour: a 4 px stripe on every added and removed line. Unchanged lines keep the gap, so the text lines up. */
  stripeColor?: string;
  /** The ticket branch against its base (the default), or a sub-branch. */
  against?: DiffAgainst;
}

/**
 * One file's diff body: fetched when it is drawn (`git:diffFile`, AL-089), unified or old and new side by
 * side, DIFF_LINES_PAGE lines at a time. Extracted from the Diff tab (AL-276) so the Diff tab, Flight
 * deck's diff column and Code City's blueprint diff draw a file the same way.
 */
export function FileDiff({
  ticketId,
  path,
  oldPath,
  view,
  onViewChange,
  stripeColor,
  against = BASE,
}: FileDiffProps) {
  const query = useDiffFile(ticketId, against, { path, oldPath });
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
      {onViewChange ? (
        <SegmentedControl
          label="Diff view"
          options={VIEW_OPTIONS}
          value={view}
          onChange={onViewChange}
          style={styles.viewSwitch}
          testID="file-diff-view"
        />
      ) : null}
      {view === "split"
        ? rows
            .slice(0, shown)
            .map((row, index) =>
              row.kind === "full" ? (
                <DiffLineRow
                  key={index}
                  line={row.line}
                  stripeColor={stripeColor}
                />
              ) : (
                <SplitLineRow
                  key={index}
                  left={row.left}
                  right={row.right}
                  stripeColor={stripeColor}
                />
              ),
            )
        : lines
            .slice(0, shown)
            .map((line, index) => (
              <DiffLineRow key={index} line={line} stripeColor={stripeColor} />
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

/** The stripe a line carries: the author's colour on a changed line, a clear gap of the same width on the others. */
function stripeStyle(
  kind: DiffLine["kind"],
  stripeColor: string | undefined,
): ViewStyle | null {
  if (!stripeColor) return null;
  return {
    borderLeftWidth: AUTHOR_STRIPE_WIDTH,
    borderLeftColor:
      kind === "add" || kind === "remove" ? stripeColor : "transparent",
  };
}

/** One side-by-side row: the old file's line on the left, the new file's on the right; blank where a side has none. */
function SplitLineRow({
  left,
  right,
  stripeColor,
}: {
  left: DiffLine | null;
  right: DiffLine | null;
  stripeColor: string | undefined;
}) {
  return (
    <View style={styles.splitRow} testID="diff-split-row">
      <SplitHalf line={left} side="old" stripeColor={stripeColor} />
      <View style={styles.splitGutter} aria-hidden />
      <SplitHalf line={right} side="new" stripeColor={stripeColor} />
    </View>
  );
}

function SplitHalf({
  line,
  side,
  stripeColor,
}: {
  line: DiffLine | null;
  side: "old" | "new";
  stripeColor: string | undefined;
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
        stripeStyle(line.kind, stripeColor),
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

function DiffLineRow({
  line,
  stripeColor,
}: {
  line: DiffLine;
  stripeColor: string | undefined;
}) {
  if (line.kind === "hunk" || line.kind === "note") {
    return (
      <View
        style={[
          styles.line,
          styles.lineHunk,
          stripeStyle(line.kind, stripeColor),
        ]}
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
        stripeStyle(line.kind, stripeColor),
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
  message: {
    gap: space.sm,
  },
  start: {
    alignSelf: "flex-start",
  },
  fileNote: {
    padding: space.md,
  },
  lines: {
    paddingVertical: space.xs,
  },
  viewSwitch: {
    alignSelf: "flex-start",
    margin: space.sm,
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
