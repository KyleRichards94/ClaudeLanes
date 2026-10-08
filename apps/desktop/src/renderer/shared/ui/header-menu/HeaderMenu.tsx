import { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, type PressableInstance } from 'react-native';
import { color, glass, minTarget, radius, shadow, space } from '@agent-lanes/tokens';
import { Icon, Text } from '@agent-lanes/ui';

export interface HeaderMenuItem {
  key: string;
  label: string;
  /** Muted text after the label ("7 – 20 Oct"). */
  detail?: string;
  /** The ticked choice. Items without it (e.g. "Add repo…") are plain actions. */
  selected?: boolean;
  /**
   * The heading this item sits under ("Current", "Upcoming", "Past"). Consecutive items with the same
   * section share one heading; items without one have none.
   */
  section?: string;
}

interface MenuGroup {
  section: string | undefined;
  items: HeaderMenuItem[];
}

/** Runs of consecutive items in the same section, in order. */
function groupBySection(items: readonly HeaderMenuItem[]): MenuGroup[] {
  const groups: MenuGroup[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.section === item.section) last.items.push(item);
    else groups.push({ section: item.section, items: [item] });
  }
  return groups;
}

export interface HeaderMenuProps {
  /** The muted word in the button ("Repo", "Sprint"). */
  label: string;
  /** The chosen value in bold ("onsite-companion", "42"). */
  value: string;
  /** Muted words after the value ("· from your ADO profile", artboard 08). */
  valueNote?: string;
  items: readonly HeaderMenuItem[];
  onSelect(key: string): void;
  disabled?: boolean;
  testID?: string;
  /** testID of the value text, so tests can read the choice. */
  valueTestID?: string;
}

interface Anchor {
  x: number;
  y: number;
  width: number;
}

const MENU_MIN_WIDTH = 220;
const MENU_MAX_HEIGHT = 360;

/**
 * The board header's Repo and Sprint dropdowns (artboard 1) and the team board's Team dropdown (artboard 08): a white capsule with the muted label,
 * the bold value and a chevron. Pressing it opens a menu under it in a transparent modal, so a press
 * outside or Escape closes it and keyboard focus stays in the menu while it is open.
 */
export function HeaderMenu({ label, value, valueNote, items, onSelect, disabled = false, testID, valueTestID }: HeaderMenuProps) {
  const trigger = useRef<PressableInstance>(null);
  const [hovered, setHovered] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const open = () => {
    const node = trigger.current;
    if (!node) return;
    node.measureInWindow((x, y, width, height) => setAnchor({ x, y: y + height + space.xs, width }));
  };
  const close = () => setAnchor(null);
  const choose = (key: string) => {
    close();
    onSelect(key);
  };

  return (
    <>
      <Pressable
        ref={trigger}
        role="button"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-label={`${label}: ${value}${valueNote ? ` ${valueNote}` : ''}`}
        disabled={disabled}
        onPress={open}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={[styles.trigger, valueNote ? styles.triggerWide : null, hovered && !disabled && styles.triggerHovered, disabled && styles.disabled]}
        testID={testID}
      >
        <Text variant="body" color={color.muted}>
          {label}
        </Text>
        <Text variant="title" numberOfLines={1} style={styles.value} testID={valueTestID}>
          {value}
        </Text>
        {valueNote ? (
          <Text variant="body" color={color.muted} numberOfLines={1}>
            {valueNote}
          </Text>
        ) : null}
        <Icon name="chevron-down" size={14} color={color.ink} />
      </Pressable>
      <Modal transparent visible={anchor !== null} onRequestClose={close} animationType="none">
        <Pressable aria-label={`Close the ${label} menu`} style={StyleSheet.absoluteFill} onPress={close} />
        {anchor ? (
          <View
            role="menu"
            aria-label={label}
            style={[styles.menu, { top: anchor.y, left: anchor.x, minWidth: Math.max(anchor.width, MENU_MIN_WIDTH) }]}
            testID={testID ? `${testID}-menu` : undefined}
          >
            <ScrollView style={styles.scroll}>
              {groupBySection(items).map((group, index) => {
                const rows = group.items.map((item) => (
                  <MenuItem key={item.key} item={item} onPress={() => choose(item.key)} testID={testID ? `${testID}-item-${item.key}` : undefined} />
                ));
                if (group.section === undefined) return rows;
                return (
                  <View
                    key={`section-${index}-${group.section}`}
                    role="group"
                    aria-label={group.section}
                    style={index > 0 ? styles.sectionDivided : undefined}
                    testID={testID ? `${testID}-section-${group.section}` : undefined}
                  >
                    <Text variant="meta" color={color.muted} style={styles.sectionHeading}>
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

/** One menu row: a tick on the chosen item, then its label and optional detail. */
function MenuItem({ item, onPress, testID }: { item: HeaderMenuItem; onPress(): void; testID?: string }) {
  const [active, setActive] = useState(false);
  return (
    <Pressable
      role="menuitem"
      aria-label={item.selected ? `${item.label}, selected` : item.label}
      onPress={onPress}
      onHoverIn={() => setActive(true)}
      onHoverOut={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      style={[styles.item, active && styles.itemActive]}
      testID={testID}
    >
      <View style={styles.tick}>{item.selected ? <Icon name="check" size={14} color={color.claude} /> : null}</View>
      <Text variant={item.selected ? 'title' : 'body'} numberOfLines={1} style={styles.itemLabel}>
        {item.label}
      </Text>
      {item.detail ? (
        <Text variant="meta" numberOfLines={1}>
          {item.detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: minTarget,
    maxWidth: 320,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  triggerHovered: {
    boxShadow: shadow.card,
  },
  disabled: {
    opacity: 0.6,
  },
  value: {
    flexShrink: 1,
  },
  // Room for the note: "Team OSC Developers · from your ADO profile" (artboard 08).
  triggerWide: {
    maxWidth: 480,
  },
  menu: {
    position: 'absolute',
    maxHeight: MENU_MAX_HEIGHT,
    paddingVertical: space.xs,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: glass.border,
    backgroundColor: color.surface,
    boxShadow: shadow.lifted,
  },
  scroll: {
    flexGrow: 0,
  },
  sectionDivided: {
    marginTop: space.xs,
    paddingTop: space.xs,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  sectionHeading: {
    paddingHorizontal: space.md,
    paddingTop: space.xs,
    paddingBottom: space.xs,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 40,
    paddingHorizontal: space.md,
  },
  itemActive: {
    backgroundColor: color.claudeTint,
  },
  tick: {
    width: 14,
  },
  itemLabel: {
    flexShrink: 1,
  },
});
