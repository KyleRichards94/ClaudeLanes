import type { AgentSessionState } from '@agent-lanes/contracts';

/** Session states with a live `claude` process that takes messages, pause and resume (AL-105). */
const LIVE: ReadonlySet<AgentSessionState> = new Set(['starting', 'running', 'idle', 'paused']);

export interface ComposerControls {
  /** The session takes messages now (or holds them while paused). */
  live: boolean;
  paused: boolean;
  /** The pause button: Pause while the agent works, Resume while paused. */
  pause: { label: 'Pause' | 'Resume'; icon: 'pause' | 'play'; disabled: boolean };
  /** "Apply model now": only while a model or effort change waits for the next turn. */
  applyModel: { disabled: boolean };
  /** Skill chips send `/skill-name`, like Send. */
  skillsDisabled: boolean;
  /** One line under the box when the composer can't send right away; null otherwise. */
  note: string | null;
}

export interface ComposerInput {
  /** The session state from `agent:getStatus` / `agent:status`; undefined while it loads. */
  state: AgentSessionState | undefined;
  /** A model or effort change is waiting for the next turn (AL-106). */
  switching: boolean;
  /** Messages sent since the session was paused, which wait for Resume. */
  held: number;
}

/** What the composer's buttons can do for a session state (artboard 3 footer). Pure, for the tests. */
export function composerControls({ state, switching, held }: ComposerInput): ComposerControls {
  const live = state !== undefined && LIVE.has(state);
  const paused = state === 'paused';
  return {
    live,
    paused,
    pause: paused ? { label: 'Resume', icon: 'play', disabled: false } : { label: 'Pause', icon: 'pause', disabled: !live || state === 'starting' },
    applyModel: { disabled: !live || paused || !switching },
    skillsDisabled: !live,
    note: composerNote(state, held),
  };
}

function composerNote(state: AgentSessionState | undefined, held: number): string | null {
  switch (state) {
    case undefined:
    case 'starting':
    case 'running':
    case 'idle':
      return null;
    case 'paused':
      return held > 0
        ? `Paused · ${held} message${held === 1 ? '' : 's'} queued, delivered on Resume`
        : 'Paused · messages you send now are delivered on Resume';
    case 'queued':
      return 'The agent has not started yet: it is waiting for a free slot.';
    case 'lost':
      return 'The session was lost. Reconnect to message the agent.';
    case 'none':
    case 'stopped':
      return 'No agent session is running for this ticket.';
  }
}

/** Ctrl+Enter (or Cmd+Enter) sends; plain Enter types a new line. */
export function isSendShortcut(event: { key: string; ctrlKey?: boolean; metaKey?: boolean; isComposing?: boolean }): boolean {
  return event.key === 'Enter' && Boolean(event.ctrlKey || event.metaKey) && !event.isComposing;
}
