import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
// One module per glyph keeps the bundle to the icons below instead of the whole lucide set.
import Archive from 'lucide-react-native/icons/archive';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import ArrowRight from 'lucide-react-native/icons/arrow-right';
import ArrowUpRight from 'lucide-react-native/icons/arrow-up-right';
import AtSign from 'lucide-react-native/icons/at-sign';
import Bot from 'lucide-react-native/icons/bot';
import Brain from 'lucide-react-native/icons/brain';
import Check from 'lucide-react-native/icons/check';
import Copy from 'lucide-react-native/icons/copy';
import Eye from 'lucide-react-native/icons/eye';
import EyeOff from 'lucide-react-native/icons/eye-off';
import File from 'lucide-react-native/icons/file';
import GitFork from 'lucide-react-native/icons/git-fork';
import Paperclip from 'lucide-react-native/icons/paperclip';
import Power from 'lucide-react-native/icons/power';
import RotateCcw from 'lucide-react-native/icons/rotate-ccw';
import Send from 'lucide-react-native/icons/send';
import SlidersHorizontal from 'lucide-react-native/icons/sliders-horizontal';
import SquarePen from 'lucide-react-native/icons/square-pen';
import UserPlus from 'lucide-react-native/icons/user-plus';
import Zap from 'lucide-react-native/icons/zap';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import ExternalLink from 'lucide-react-native/icons/external-link';
import GitBranch from 'lucide-react-native/icons/git-branch';
import GitMerge from 'lucide-react-native/icons/git-merge';
import GripVertical from 'lucide-react-native/icons/grip-vertical';
import Hammer from 'lucide-react-native/icons/hammer';
import Info from 'lucide-react-native/icons/info';
import Link from 'lucide-react-native/icons/link';
import List from 'lucide-react-native/icons/list';
import Lock from 'lucide-react-native/icons/lock';
import Pause from 'lucide-react-native/icons/pause';
import Play from 'lucide-react-native/icons/play';
import Plus from 'lucide-react-native/icons/plus';
import RotateCw from 'lucide-react-native/icons/rotate-cw';
import Search from 'lucide-react-native/icons/search';
import Square from 'lucide-react-native/icons/square';
import TriangleAlert from 'lucide-react-native/icons/triangle-alert';
import X from 'lucide-react-native/icons/x';

interface Glyph {
  component: LucideIcon;
  /** Media controls are drawn solid, as on the drill-in artboard (Run ▶, Stop ■, pause ❚❚). */
  filled?: boolean;
}

/**
 * The app's icon set, named for what the icon means rather than what it draws,
 * so a glyph can change without touching callers. Lucide (ISC) via react-native-svg.
 */
const glyphs = {
  plus: { component: Plus },
  link: { component: Link },
  'chevron-down': { component: ChevronDown },
  'chevron-up': { component: ChevronUp },
  'chevron-left': { component: ChevronLeft },
  'chevron-right': { component: ChevronRight },
  'arrow-left': { component: ArrowLeft },
  'arrow-right': { component: ArrowRight },
  /** The small ↗ after "Open in Azure DevOps" and on the "Claude Design" tab. */
  'arrow-up-right': { component: ArrowUpRight },
  'external-link': { component: ExternalLink },
  play: { component: Play, filled: true },
  stop: { component: Square, filled: true },
  pause: { component: Pause, filled: true },
  build: { component: Hammer },
  branch: { component: GitBranch },
  merge: { component: GitMerge },
  refresh: { component: RotateCw },
  search: { component: Search },
  check: { component: Check },
  close: { component: X },
  lock: { component: Lock },
  alert: { component: CircleAlert },
  /** Info and warning toasts (AL-030); error toasts use `alert`, as on artboard 6. */
  info: { component: Info },
  warning: { component: TriangleAlert },
  /** The team board's drag handle and Backlog button (AL-234, artboard 08). */
  grip: { component: GripVertical },
  backlog: { component: List },
  /** The ticket's agent controls (E15): end a session, rewind, fork, assign an agent, compact, thinking, archive. */
  power: { component: Power },
  rewind: { component: RotateCcw },
  fork: { component: GitFork },
  copy: { component: Copy },
  thinking: { component: Brain },
  archive: { component: Archive },
  send: { component: Send },
  attach: { component: Paperclip },
  'add-agent': { component: UserPlus },
  agent: { component: Bot },
  permissions: { component: SlidersHorizontal },
  file: { component: File },
  compact: { component: Zap },
  mention: { component: AtSign },
  show: { component: Eye },
  hide: { component: EyeOff },
  edit: { component: SquarePen },
} as const satisfies Record<string, Glyph>;

export type IconName = keyof typeof glyphs;

/** Every icon name, for the component gallery and tests. */
export const iconNames = Object.keys(glyphs) as IconName[];

interface IconStyle {
  color?: string;
  size?: number;
}

const IconStyleContext = createContext<IconStyle>({});

export interface IconProviderProps extends IconStyle {
  children?: ReactNode;
}

/**
 * Sets the colour and size that icons below it inherit. Text-bearing primitives
 * (Button, Pill, Tabs, Toast) should wrap their label row in this with the label's colour
 * and font size, so a leading icon matches its text.
 */
export function IconProvider({ color, size, children }: IconProviderProps) {
  const inherited = useContext(IconStyleContext);
  const value = useMemo(
    () => ({ color: color ?? inherited.color, size: size ?? inherited.size }),
    [color, size, inherited.color, inherited.size],
  );
  return <IconStyleContext.Provider value={value}>{children}</IconStyleContext.Provider>;
}

/**
 * With no explicit or provided style, an icon takes the surrounding text's colour and size:
 * `currentColor` and `1em` on web (CSS inheritance from the enclosing text), and a 16 px
 * fallback on native, where SVG has no em unit.
 */
const textColor = 'currentColor';
const textSize = Platform.select<number | string>({ web: '1em', default: 16 });

export interface IconProps {
  name: IconName;
  /** Overrides the inherited colour. */
  color?: string;
  /** Pixel size. Overrides the inherited size. */
  size?: number;
  /**
   * Accessible name for an icon that carries meaning on its own (an icon-only button's
   * glyph is decorative; the button gets the label). Without it the icon is decorative and
   * hidden from screen readers.
   */
  label?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** One icon from the app set. Decorative unless it has a `label`. */
export function Icon({ name, color, size, label, style, testID }: IconProps) {
  const inherited = useContext(IconStyleContext);
  const glyph: Glyph = glyphs[name];
  const Component = glyph.component;
  const resolvedColor = color ?? inherited.color ?? textColor;
  const resolvedSize = size ?? inherited.size ?? textSize;
  const a11y = label ? ({ role: 'img', 'aria-label': label } as const) : ({ 'aria-hidden': true } as const);

  return (
    <Component
      {...a11y}
      color={resolvedColor}
      fill={glyph.filled ? resolvedColor : 'none'}
      size={resolvedSize}
      style={style}
      testID={testID}
    />
  );
}
