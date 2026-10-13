import type { ChangedFile, ReviewStatus } from '@agent-lanes/contracts';
import { shade } from '@/shared/lib';
import { UNKNOWN_AUTHOR_COLOR, type CityAgent, type CityAgentKind } from './types';

/** Pure helpers shared by the Code City scene, overlays and rail. No DOM. */

export const UNKNOWN_AUTHOR_NAME = 'you or a merge';

export const REVIEW_WORDS: Record<ReviewStatus, string> = {
  notReviewed: 'Not reviewed',
  inReview: 'In review',
  passed: 'Passed',
  changesRequested: 'Changes requested',
};

export interface Author {
  /** The agent, or null for "you or a merge" and for an author the session no longer lists. */
  agent: CityAgent | null;
  color: string;
  name: string;
}

export function authorOf(file: Pick<ChangedFile, 'authorAgentId'>, agents: readonly CityAgent[]): Author {
  const agent = file.authorAgentId ? (agents.find((a) => a.id === file.authorAgentId) ?? null) : null;
  return agent ? { agent, color: agent.color, name: agent.name } : { agent: null, color: UNKNOWN_AUTHOR_COLOR, name: UNKNOWN_AUTHOR_NAME };
}

/** Face colours of a building from its author colour C (handoff "Building element"). */
export function faceColors(color: string): { c1: string; c2: string; c3: string } {
  return { c1: shade(color, 0.55), c2: shade(color, 0.15), c3: shade(color, -0.2) };
}

/** The verb on an agent's pin. */
export const PIN_VERBS: Record<Exclude<CityAgentKind, 'idle'>, string> = {
  edit: 'building',
  review: 'inspecting',
  test: 'testing',
  read: 'reading',
};

export interface Pin {
  agent: CityAgent;
  path: string;
  verb: string;
}

/**
 * Pins: a running agent whose active file is in the city. Other running agents appear in the crew panel only.
 */
export function pinsFor(agents: readonly CityAgent[], paths: ReadonlySet<string>): Pin[] {
  const pins: Pin[] = [];
  for (const agent of agents) {
    if (agent.status !== 'running' || agent.activeKind === 'idle' || !agent.activeFile || !paths.has(agent.activeFile)) continue;
    pins.push({ agent, path: agent.activeFile, verb: PIN_VERBS[agent.activeKind] });
  }
  return pins;
}

export type CrewTone = 'running' | 'done' | 'error' | 'idle';

/** The status word on a crew row, and the tone that colours it. */
export function crewStatus(agent: CityAgent, paths: ReadonlySet<string>): { word: string; tone: CrewTone } {
  if (agent.status === 'error') return { word: 'Stopped', tone: 'error' };
  if (agent.status === 'done' || agent.status === 'idle') return { word: 'Off shift', tone: agent.status === 'done' ? 'done' : 'idle' };
  if (agent.activeFile && agent.activeKind !== 'idle' && !paths.has(agent.activeFile)) return { word: 'Reading', tone: 'running' };
  switch (agent.activeKind) {
    case 'review':
      return { word: 'Inspecting', tone: 'running' };
    case 'test':
      return { word: 'Testing', tone: 'running' };
    case 'edit':
      return { word: 'Building', tone: 'running' };
    case 'read':
      return { word: 'Reading', tone: 'running' };
    default:
      return { word: agent.role === 'lead' ? 'Directing' : 'Working', tone: 'running' };
  }
}

/** "{file name}, {district}, {added} lines added, {removed} removed, by {agent}, {review status}" */
export function accessibleName(args: { name: string; district: string; added: number; removed: number; author: string; review: ReviewStatus; binary: boolean }): string {
  const lines = args.binary ? 'binary file' : `${args.added} lines added, ${args.removed} removed`;
  return `${args.name}, ${args.district}, ${lines}, by ${args.author}, ${REVIEW_WORDS[args.review]}`;
}

// ── Label overlap nudging ───────────────────────────────────────────────────────────────────────────

export const CHIP_HEIGHT = 26;
/** A label sits this far above its anchor. */
export const CHIP_GAP = 8;
const MONO_CHAR = 7.2;
const CHIP_CHROME = 20;

/** The width of a mono 12 px chip, estimated: padding 9 + border 1 each side. */
export function chipWidth(text: string, extraChars = 0): number {
  return Math.ceil((text.length + extraChars) * MONO_CHAR + CHIP_CHROME);
}

export interface LabelBox {
  key: string;
  /** Anchor, in scene px. */
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const intersects = (a: Rect, b: Rect): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * When two labels overlap, the later one moves up by its height plus 4 px, repeated until clear, at most 3 passes.
 * `fixed` are rectangles that never move (district labels). Returns the upward offset in px by label key.
 */
export function nudgeLabels(labels: readonly LabelBox[], fixed: readonly Rect[] = []): Record<string, number> {
  const placed: Rect[] = [...fixed];
  const offsets: Record<string, number> = {};
  for (const label of labels) {
    let offset = 0;
    const rectAt = (up: number): Rect => {
      const top = label.y - CHIP_GAP - label.h - up;
      return { left: label.x - label.w / 2, right: label.x + label.w / 2, top, bottom: top + label.h };
    };
    for (let pass = 0; pass < 3; pass++) {
      if (!placed.some((r) => intersects(rectAt(offset), r))) break;
      offset += label.h + 4;
    }
    offsets[label.key] = offset;
    placed.push(rectAt(offset));
  }
  return offsets;
}

// ── District plot colours ───────────────────────────────────────────────────────────────────────────

/** Four rotating plot colour pairs: blue, violet, teal, slate (handoff "District plots"). */
export const PLOT_PAIRS = [
  { bg: 'rgba(224,242,254,.6)', border: '#7DD3FC' },
  { bg: 'rgba(238,235,255,.6)', border: '#C4B5FD' },
  { bg: 'rgba(204,251,241,.5)', border: '#5EEAD4' },
  { bg: 'rgba(241,245,249,.8)', border: '#CBD5E1' },
] as const;

export const plotPair = (districtIndex: number): { bg: string; border: string } => PLOT_PAIRS[districtIndex % PLOT_PAIRS.length] ?? PLOT_PAIRS[0];
