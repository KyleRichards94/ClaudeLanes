import { useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type {
  DiffAgainst,
  DiffFile,
  TicketSubBranch,
} from "@agent-lanes/contracts";
import { color, minTarget, radius, space, tone } from "@agent-lanes/tokens";
import { Button, Icon, Pill, SegmentedControl, Text } from "@agent-lanes/ui";
import {
  DIFF_LINES_PAGE,
  FileDiff,
  diffStats,
  diffStatus,
  fileCount,
} from "@/entities/diff-file";
import { useTicketDiff } from "@/shared/api";
import type { DiffView } from "@/shared/model";

// The per-file renderer moved to `entities/diff-file` (AL-276); the page's tests and callers still import this from here.
export { DIFF_LINES_PAGE };

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
          path={file.path}
          oldPath={file.oldPath}
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
});
