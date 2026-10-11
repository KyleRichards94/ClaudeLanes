import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { color, glass, minTarget, radius, shadow, space, tone } from '@agent-lanes/tokens';
import { Icon, Text, type IconName } from '@agent-lanes/ui';

export interface ActionMenuItem {
  key: string;
  label: string;
  /** Muted text under the label ("Ends the Claude Code process; the worktree stays"). */
  detail?: string;
  icon?: IconName;
  /** A destructive action, drawn in the danger tone. */
  danger?: boolean;
  disabled?: boolean;
  /** The ticked choice, for a group of alternatives (permission modes, stages). */
  selected?: boolean;
  /** The heading this item sits under; consecutive items with the same section share one heading. */
  section?: string;
}

/** Where a menu opens: a point in window coordinates (under a trigger, or at the pointer for a context menu). */
export interface MenuAnchor {
  x: number;
  y: number;
}

export interface MenuPopoverProps {
  /** The menu's accessible name ("Agent", "Ticket actions"). */
  label: string;
  items: readonly ActionMenuItem[];
  /** Open at this point; null closes it. */
  anchor: MenuAnchor | null;
  onSelect(key: string): void;
  onClose(): void;
  testID?: string;
}

export const MENU_WIDTH = 280;
const MENU_MAX_HEIGHT = 420;

interface Group {
  section: string | undefined;
  items: ActionMenuItem[];
}

function groupBySection(items: readonly ActionMenuItem[]): Group[] {
  const groups: Group[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.section === item.section) last.items.push(item);
    else groups.push({ section: item.section, items: [item] });
  }
  return groups;
}

export function windowSizeNow(): { width: number; height: number } {
  const view = globalThis as { innerWidth?: number; innerHeight?: number };
  return {
    width: typeof view.innerWidth === 'number' && view.innerWidth > 0 ? view.innerWidth : 1440,
    height: typeof view.innerHeight === 'number' && view.innerHeight > 0 ? view.innerHeight : 960,
  };
}

/**
 * A menu of actions at a point (AL-253's Agent ▾ menu, AL-270's card context menu). It sits in a
 * transparent modal, so a press outside or Escape closes it and keyboard focus stays inside while
 * it is open. Items can carry a detail line, an icon, a danger tone and a tick; sections group them.
 * A menu near the right or bottom edge opens leftwards or upwards.
 */
export function MenuPopover({ label, items, anchor, onSelect, onClose, testID }: MenuPopoverProps) {
  const choose = (key: string) => {
    onClose();
    onSelect(key);
  };
  const window = windowSizeNow();
  const left = anchor ? Math.max(space.sm, Math.min(anchor.x, window.width - MENU_WIDTH - space.sm)) : 0;
  const top = anchor ? Math.max(space.sm, Math.min(anchor.y, window.height - MENU_MAX_HEIGHT - space.sm)) : 0;
  return (
    <Modal transparent visible={anchor !== null} onRequestClose={onClose} animationType="none">
      <Pressable aria-label={`Close the ${label} menu`} style={StyleSheet.absoluteFill} onPress={onClose} />
      {anchor ? (
        <View role="menu" aria-label={label} style={[styles.menu, { top, left }]} testID={testID ? `${testID}-menu` : undefined}>
          <ScrollView style={styles.scroll}>
            {groupBySection(items).map((group, index) => {
              const rows = group.items.map((item) => (
                <MenuItem key={item.key} item={item} onPress={() => choose(item.key)} testID={testID ? `${testID}-item-${item.key}` : undefined} />
              ));
              if (group.section === undefined) return <View key={`group-${index}`} style={index > 0 ? styles.sectionDivided : undefined}>{rows}</View>;
              return (
                <View key={`section-${index}-${group.section}`} role="group" aria-label={group.section} style={index > 0 ? styles.sectionDivided : undefined}>
                  <Text variant="meta" size="xs" color={color.muted} style={styles.sectionHeading}>
                    {group.section}
                  </Text>
                  {rows}
                </View>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </Modal>
  );
}

function MenuItem({ item, onPress, testID }: { item: ActionMenuItem; onPress(): void; testID?: string }) {
  const [active, setActive] = useState(false);
  const ink = item.danger ? tone.danger.text : color.ink;
  return (
    <Pressable
      role="menuitem"
      aria-label={item.selected ? `${item.label}, selected` : item.label}
      aria-disabled={item.disabled}
      disabled={item.disabled}
      onPress={onPress}
      onHoverIn={() => setActive(true)}
      onHoverOut={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      style={[styles.item, active && !item.disabled && styles.itemActive, item.disabled && styles.disabled]}
      testID={testID}
    >
      <View style={styles.tick}>
        {item.selected ? <Icon name="check" size={14} color={color.claude} /> : item.icon ? <Icon name={item.icon} size={14} color={ink} /> : null}
      </View>
      <View style={styles.itemText}>
        <Text variant={item.selected ? 'title' : 'body'} color={ink} numberOfLines={1}>
          {item.label}
        </Text>
        {item.detail ? (
          <Text variant="meta" size="xs" numberOfLines={2}>
            {item.detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  disabled: {
    opacity: 0.6,
  },
  menu: {
    position: 'absolute',
    width: MENU_WIDTH,
    maxHeight: MENU_MAX_HEIGHT,
    paddingVertical: space.xs,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: glass.border,
    backgroundColor: color.surface,
    boxShadow: shadow.lifted,
  },
  scroll: {
    maxHeight: MENU_MAX_HEIGHT - 2 * space.xs,
  },
  sectionDivided: {
    marginTop: space.xs,
    paddingTop: space.xs,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  sectionHeading: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    textTransform: 'uppercase',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: minTarget,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  itemActive: {
    backgroundColor: color.bg,
  },
  tick: {
    width: 16,
    alignItems: 'center',
  },
  itemText: {
    flex: 1,
    gap: 2,
  },
});
