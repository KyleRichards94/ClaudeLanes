import { Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Icon, Pill, Text } from '@agent-lanes/ui';
import { LaneDragCard, type LaneDragData } from '@/features/drag-to-lane';
import type { BacklogRowView } from '../model/view';
import { NativeDragRow } from './native-row';

export interface BacklogRowProps {
  row: BacklogRowView;
  /** The row's drag, with the selected group when the row is part of it. */
  drag: LaneDragData | null;
  selected: boolean;
  /** A click on the row or its checkbox; `shift` selects every row from the last one clicked. */
  onSelect(shift: boolean): void;
  /** In the popped-out window the row is a native drag source instead of a dnd-kit one. */
  popped: boolean;
}

/** react-native-web hands Pressable the DOM click, which knows whether Shift was down. */
function shiftOf(event: GestureResponderEvent): boolean {
  const native = event.nativeEvent as unknown as { shiftKey?: boolean };
  return native.shiftKey === true || (event as unknown as { shiftKey?: boolean }).shiftKey === true;
}

/**
 * One backlog row (artboard 11): grip, checkbox, `#71360`, type pill, title, tag, points and the
 * priority badge. A row you can't take shows who has it; a row an agent works on keeps an "Agent in
 * Planning" tag (TB§5). Rows drag onto Planning or Implementing like team board cards (AL-235), Enter
 * opens "Send to lane", and a click or shift-click selects them for a group drag.
 */
export function BacklogRow({ row, drag, selected, onSelect, popped }: BacklogRowProps) {
  const summary = [
    `${row.idLabel} ${row.type}`,
    row.title,
    row.tag ? `tag ${row.tag}` : null,
    row.points,
    row.priority === null ? null : `priority ${row.priority}`,
    row.inSprint ? 'in a sprint' : null,
    row.lock ? `locked: ${row.lock}` : null,
    row.agentTag,
    selected ? 'selected' : null,
  ]
    .filter(Boolean)
    .join(', ');

  const checkbox = (
    <Pressable
      role="checkbox"
      aria-checked={selected}
      aria-label={`Select ${row.idLabel}`}
      disabled={!row.drag}
      hitSlop={13}
      onPress={(event) => onSelect(shiftOf(event))}
      style={[styles.checkbox, selected && styles.checkboxOn, !row.drag && styles.checkboxOff]}
      testID={`backlog-row-${row.id}-select`}
    >
      {selected ? <Icon name="check" size={12} color={color.surface} /> : null}
    </Pressable>
  );

  const Shell = popped ? NativeDragRow : LaneDragCard;
  return (
    <Shell
      drag={drag}
      label={summary}
      style={[styles.row, selected && styles.rowSelected]}
      accessory={checkbox}
      onClick={row.drag ? (event) => onSelect(event.shiftKey) : undefined}
      testID={`backlog-row-${row.id}`}
    >
      <View aria-hidden style={styles.grip}>
        <Icon name="grip" size={14} color={row.drag ? color.muted : color.line} />
      </View>
      {/* The checkbox sits over this gap, beside the drag handle rather than inside it. */}
      <View style={styles.checkboxGap} />
      <Text variant="mono" size="sm" color={tone.ado.text} style={styles.id}>
        {row.idLabel}
      </Text>
      <Pill label={row.type} tone={row.typeTone} style={styles.type} />
      <View style={styles.titleCell}>
        <Text variant="title" numberOfLines={1} style={styles.title}>
          {row.title}
        </Text>
        {row.agentTag ? <Pill label={row.agentTag} tone="claude" dot style={styles.inline} testID={`backlog-row-${row.id}-agent`} /> : null}
        {row.lock ? (
          <View style={styles.lock} testID={`backlog-row-${row.id}-lock`}>
            <Icon name="lock" size={12} color={tone.neutral.text} />
            <Text variant="meta" size="sm" color={tone.neutral.text} numberOfLines={1}>
              {row.lock}
            </Text>
          </View>
        ) : null}
        {row.inSprint ? <Pill label="In a sprint" tone="ado" style={styles.inline} /> : null}
      </View>
      <View style={styles.tagCell}>{row.tag ? <Pill label={row.tag} tone="neutral" style={styles.inline} /> : null}</View>
      <Text variant="meta" style={styles.points}>
        {row.points ?? ''}
      </Text>
      <View style={[styles.priority, row.priority === 1 ? styles.priorityTop : null]} aria-label={row.priority === null ? 'No priority' : `Priority ${row.priority}`} role="img">
        <Text variant="title" size="xs" color={row.priority === 1 ? tone.attention.text : tone.neutral.text}>
          {row.priority === null ? '–' : String(row.priority)}
        </Text>
      </View>
    </Shell>
  );
}

/** Left padding, grip and gap: where the checkbox goes over the row. */
const ROW_PADDING = space.xl;
const GRIP = 14;
const BOX = 18;
const ROW_HEIGHT = 56;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    height: ROW_HEIGHT,
    paddingLeft: ROW_PADDING,
    paddingRight: space.xl,
    borderRadius: radius.control,
  },
  rowSelected: {
    backgroundColor: tone.claude.wash,
  },
  grip: {
    width: GRIP,
  },
  checkboxGap: {
    width: BOX,
  },
  checkbox: {
    position: 'absolute',
    left: ROW_PADDING + GRIP + space.md,
    top: (ROW_HEIGHT - BOX) / 2,
    width: BOX,
    height: BOX,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: tone.neutral.dot,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    borderColor: color.claude,
    backgroundColor: color.claude,
  },
  checkboxOff: {
    opacity: 0.4,
  },
  id: {
    width: 64,
  },
  type: {
    alignSelf: 'center',
    minWidth: 56,
    justifyContent: 'center',
  },
  inline: {
    alignSelf: 'center',
  },
  titleCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minWidth: 0,
  },
  title: {
    flexShrink: 1,
  },
  lock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.chip,
    backgroundColor: tone.neutral.band,
  },
  tagCell: {
    width: 96,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  points: {
    width: 44,
    textAlign: 'right',
  },
  priority: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tone.neutral.band,
  },
  priorityTop: {
    backgroundColor: tone.attention.band,
  },
});
