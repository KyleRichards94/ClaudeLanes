import { useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, type PressableInstance } from 'react-native';
import { color, radius, shadow, space } from '@agent-lanes/tokens';
import { Icon, Text, type IconName } from '@agent-lanes/ui';
import { MenuPopover, type ActionMenuItem, type MenuAnchor } from './MenuPopover';

export type { ActionMenuItem } from './MenuPopover';

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

/**
 * A button that opens a menu of actions under it (AL-253: the ticket's Agent ▾ menu). The menu is a
 * `MenuPopover` anchored under the trigger; the card context menu (AL-270) opens the same popover at
 * the pointer.
 */
export function ActionMenu({ label, icon = 'chevron-down', iconOnly = false, items, onSelect, disabled = false, leading, testID }: ActionMenuProps) {
  const trigger = useRef<PressableInstance>(null);
  const [hovered, setHovered] = useState(false);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

  const open = () => {
    const node = trigger.current;
    if (!node) return;
    node.measureInWindow((x, y, _width, height) => setAnchor({ x, y: y + height + space.xs }));
  };

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
      <MenuPopover label={label} items={items} anchor={anchor} onSelect={onSelect} onClose={() => setAnchor(null)} testID={testID} />
    </>
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
});
