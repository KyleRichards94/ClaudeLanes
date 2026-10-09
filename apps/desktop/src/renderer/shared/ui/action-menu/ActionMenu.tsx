import { useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, type PressableInstance } from 'react-native';
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

export interface ActionMenuProps {
  /** The button's label ("Agent"); with `iconOnly` it is the accessible name. */
  label: string;
  icon?: IconName;
  iconOnly?: boolean;
  items: readonly ActionMenuItem[];
  onSelect(key: string): void;
  disabled?: boolean;
  /** Something drawn inside the trigger before the label (a status dot). */
  leading?: ReactNode;
  testID?: string;
}

interface Anchor {
  x: number;
  y: number;
  width: number;
  /** The window's width, so a menu near the right edge opens leftwards. */
  windowWidth: number;
}

const MENU_WIDTH = 280;
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

/**
 * A button that opens a menu of actions under it (AL-253: the ticket's Agent ▾ menu). The menu sits in
 * a transparent modal, so a press outside or Escape closes it and keyboard focus stays inside while it
 * is open. Items can carry a detail line, an icon, a danger tone and a tick; sections group them.
 */
export function ActionMenu({ label, icon = 'chevron-down', iconOnly = false, items, onSelect, disabled = false, leading, testID }: ActionMenuProps) {
  const trigger = useRef<PressableInstance>(null);
  const [hovered, setHovered] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const open = () => {
    const node = trigger.current;
    if (!node) return;
    node.measureInWindow((x, y, width, height) => setAnchor({ x, y: y + height + space.xs, width, windowWidth: windowWidthNow() }));
  };
  const close = () => setAnchor(null);
  const choose = (key: string) => {
    close();
    onSelect(key);
  };
  const left = anchor ? Math.max(space.sm, Math.min(anchor.x, anchor.windowWidth - MENU_WIDTH - space.sm)) : 0;

  return (
    <>
      <Pressable
        ref={trigger}
        role="button"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-label={label}
        disabled={disabled}
        onPress={open}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={[styles.trigger, iconOnly && styles.triggerIconOnly, hovered && !disabled && styles.triggerHovered, disabled && styles.disabled]}
        testID={testID}
      >
        {leading}
        {iconOnly ? null : (
          <Text variant="title" size="sm" numberOfLines={1}>
            {label}
          </Text>
        )}
        <Icon name={icon} size={14} color={color.ink} />
      </Pressable>
      <Modal transparent visible={anchor !== null} onRequestClose={close} animationType="none">
        <Pressable aria-label={`Close the ${label} menu`} style={StyleSheet.absoluteFill} onPress={close} />
        {anchor ? (
          <View role="menu" aria-label={label} style={[styles.menu, { top: anchor.y, left }]} testID={testID ? `${testID}-menu` : undefined}>
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
    </>
  );
}

function windowWidthNow(): number {
  const view = globalThis as { innerWidth?: number };
  return typeof view.innerWidth === 'number' && view.innerWidth > 0 ? view.innerWidth : 1440;
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
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    minHeight: 38,
    paddingHorizontal: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  triggerIconOnly: {
    width: 38,
    justifyContent: 'center',
    paddingHorizontal: 0,
  },
  triggerHovered: {
    boxShadow: shadow.card,
  },
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
