import { useId, type ReactNode, type RefObject } from 'react';
import { Modal as NativeModal, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { color, glass, overlay, radius, space } from '@agent-lanes/tokens';
import { Button } from './Button';
import { GlassPanel } from './GlassPanel';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/** Header icon tile: `claude` violet (New agent ticket, artboard 2) or `ado` blue (Connections, artboard 5). */
export type ModalIconTone = 'claude' | 'ado';

interface ModalContentProps {
  /** Shows the modal. Hiding it (or unmounting) returns focus to whatever had it before it opened. */
  visible: boolean;
  /** Header title and the dialog's accessible name. */
  title: string;
  /** One line under the title, read out as the dialog's description. */
  subtitle?: string;
  /** Icon in the tinted tile before the title. */
  icon?: IconName;
  /** Defaults to `claude`. */
  iconTone?: ModalIconTone;
  /** Body content. Scrolls when the modal would be taller than the window. */
  children?: ReactNode;
  /**
   * Footer row under a divider: a note and the actions (Cancel, Save connections). Items sit at the
   * end of the row, 12 px apart; give a note `flex: 1` to push the buttons right.
   */
  footer?: ReactNode;
  /** Panel width in px, shrunk to fit narrower windows. Defaults to 920 (Connections); New agent ticket is 1040. */
  width?: number;
  /**
   * Pads the body like the header and footer (default). Turn it off for bodies that lay out their own
   * columns edge to edge, such as New agent ticket's two columns split by a full-height divider.
   */
  padded?: boolean;
  /**
   * Control that takes focus when the modal opens. Defaults to the first focusable element (the close
   * button, or the first control of a blocking modal).
   */
  initialFocusRef?: RefObject<{ focus(): void } | null>;
  /** Accessible name of the close button. Defaults to "Close". */
  closeLabel?: string;
  /** On the dialog element; the panel is `<testID>-panel` and the backdrop `<testID>-backdrop`. */
  testID?: string;
}

/**
 * A normal modal closes with its close button or Esc, which call `onClose`; the parent then hides it.
 * A `blocking` modal (first-run Connections) has no close button and ignores Esc: it goes away only
 * when the parent hides it, so `onClose` is optional and never called while blocking.
 */
type ModalDismissProps =
  | {
      blocking?: false;
      /** Called by the close button and by Esc. */
      onClose: () => void;
    }
  | {
      blocking: true;
      onClose?: () => void;
    };

export type ModalProps = ModalContentProps & ModalDismissProps;

/**
 * The app's modal (design §11, artboards 2 and 5): a glass `xl` panel (radius 28) over a blurred,
 * washed-out app, with a header (icon tile, title, subtitle, close button), a body and a footer slot.
 *
 * Built on React Native's `Modal`, which react-native-web renders into a portal on `document.body`
 * as `role="dialog"` with `aria-modal`. That gives the keyboard behaviour: focus moves into the modal
 * when it opens, Tab and Shift+Tab wrap inside it and never reach the app behind, Esc asks to close
 * (only the topmost of stacked modals), and focus returns to the opener when it closes. Clicking the
 * backdrop does nothing, so a half-filled form is never lost to a stray click.
 */
export function Modal({
  visible,
  title,
  subtitle,
  icon,
  iconTone = 'claude',
  children,
  footer,
  width = defaultWidth,
  padded = true,
  initialFocusRef,
  closeLabel = 'Close',
  testID,
  blocking = false,
  onClose,
}: ModalProps) {
  const titleId = useId();
  const subtitleId = useId();
  const close = blocking ? ignore : onClose;

  return (
    <NativeModal
      visible={visible}
      transparent
      // Animated modals only become active (focus trap, Esc) when a CSS animation ends; open at once.
      animationType="none"
      // Esc on web (react-native-web listens for it while this is the topmost modal), back on Android.
      onRequestClose={close ?? ignore}
      // Runs after react-native-web has noted the opener to give focus back to, so moving focus here is safe.
      onShow={() => initialFocusRef?.current?.focus()}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      testID={testID}
    >
      <View style={styles.root}>
        {/* A sibling of the panel, not its parent: a backdrop-filter ancestor would stop the panel's own glass blurring what is behind. */}
        <View aria-hidden testID={testID ? `${testID}-backdrop` : undefined} style={[StyleSheet.absoluteFill, styles.backdrop, backdropBlur]} />
        <GlassPanel level="xl" testID={testID ? `${testID}-panel` : undefined} style={[styles.panel, { width }, panelShadow]}>
          <View style={styles.header}>
            {icon ? (
              <View testID={testID ? `${testID}-icon` : undefined} style={[styles.iconTile, tileStyles[iconTone]]}>
                <Icon name={icon} size={iconSize} color={tileInk[iconTone]} />
              </View>
            ) : null}
            <View style={styles.heading}>
              <Text id={titleId} variant="display" size="xl" role="heading" aria-level={2}>
                {title}
              </Text>
              {subtitle ? (
                <Text id={subtitleId} variant="meta" size="md">
                  {subtitle}
                </Text>
              ) : null}
            </View>
            {blocking || !onClose ? null : <Button iconOnly icon="close" label={closeLabel} onPress={onClose} />}
          </View>
          <ScrollView style={styles.body} contentContainerStyle={padded ? styles.padded : undefined}>
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </GlassPanel>
      </View>
    </NativeModal>
  );
}

function ignore() {}

/** Connections (artboard 5) is 920 px wide; New agent ticket (artboard 2) passes 1040. */
const defaultWidth = 920;

/**
 * Read off artboards 2 and 5: 26 px sides (header, body and footer line up), 22 px above and below
 * the header's 44 px close button (88 px header), 24 px body padding, a 40 px icon tile with a 20 px
 * glyph 14 px before the title, and an 18 px footer around 44 px buttons spaced 12 apart.
 */
const sidePadding = 26;
const iconTileSize = 40;
const iconSize = 20;

const tileInk: Record<ModalIconTone, string> = { claude: color.claude, ado: color.ado };

/** Web-only style keys (react-native-web passes them through to CSS), outside the RN style types. */
const backdropBlur = {
  backdropFilter: `blur(${overlay.scrimBlur}px)`,
  WebkitBackdropFilter: `blur(${overlay.scrimBlur}px)`,
} as unknown as ViewStyle;

/** Keeps GlassPanel's inset top highlight and adds the modal's drop shadow under it. */
const panelShadow: ViewStyle = { boxShadow: `${glass.highlight}, ${overlay.shadow}` };

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  backdrop: {
    backgroundColor: overlay.scrim,
  },
  panel: {
    maxWidth: '100%',
    maxHeight: '100%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: sidePadding,
    paddingVertical: 22,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  iconTile: {
    width: iconTileSize,
    height: iconTileSize,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
  },
  heading: {
    flex: 1,
    gap: 2,
  },
  body: {
    flexShrink: 1,
  },
  padded: {
    paddingHorizontal: sidePadding,
    paddingVertical: space.xl,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space.md,
    paddingHorizontal: sidePadding,
    paddingVertical: 18,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
});

const tileStyles = StyleSheet.create({
  claude: { backgroundColor: color.claudeTint },
  ado: { backgroundColor: color.adoTint },
});
