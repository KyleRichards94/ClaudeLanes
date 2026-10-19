import { create } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';
import { appearanceOf, defaultUiPrefs, type Appearance, type EmbedMode, type Lane, type UiPrefs } from '@agent-lanes/contracts';
import { createUiPrefsStorage } from '@/shared/api';

/**
 * Persisted UI prefs (design §6): last repo, team and sprint, collapsed lanes, and the Claude Design embed
 * mode per ticket. Saved in the main-process settings store on every change and loaded by
 * `hydrateUiPrefs()`, which the app runs before the first page renders.
 */
export interface UiPrefsState extends UiPrefs {
  setLastRepo(path: string | null): void;
  setLastSprint(sprintId: string | null): void;
  /** Picks the board team; its sprints differ, so the picked sprint goes back to the current one. */
  setLastTeam(teamId: string | null): void;
  setLaneCollapsed(lane: Lane, collapsed: boolean): void;
  toggleLane(lane: Lane): void;
  setEmbedMode(ticketId: string, mode: EmbedMode): void;
  /** Keeps a ticket's unsent composer text (AL-259); an empty draft is dropped. */
  setComposerDraft(ticketId: string, draft: string): void;
  /** Shows or hides the agent's thinking in the output (AL-262). */
  setShowThinking(show: boolean): void;
  /** Picks the ticket screen's layout for every ticket (AL-275). */
  setTicketLayout(layout: TicketLayout): void;
  /** Closes the Code City "how to read it" card for good (AL-275). */
  setCodeCityLegendDismissed(dismissed: boolean): void;
  /** Light, dark, or the computer's appearance. Applies at once. */
  setAppearance(appearance: Appearance): void;
}

/** The ticket screen's two layouts (AL-275): Flight deck is the default. */
export type TicketLayout = NonNullable<UiPrefs['ticketLayout']>;
export const DEFAULT_TICKET_LAYOUT: TicketLayout = 'flightDeck';

/** The embed mode of a ticket that has never been switched (AL-194). */
export const DEFAULT_EMBED_MODE: EmbedMode = 'webview';

function pickPrefs({
  lastRepo,
  lastSprint,
  lastTeam,
  collapsedLanes,
  embedModeByTicket,
  composerDrafts,
  showThinking,
  ticketLayout,
  codeCityLegendDismissed,
  appearance,
}: UiPrefsState): UiPrefs {
  return {
    lastRepo,
    lastSprint,
    lastTeam,
    collapsedLanes,
    embedModeByTicket,
    composerDrafts,
    showThinking,
    ticketLayout,
    codeCityLegendDismissed,
    appearance: appearance ?? 'system',
  };
}

/** Builds a UI prefs store over the given storage; the app uses `useUiPrefs`, tests make their own. */
export function createUiPrefsStore(storage: PersistStorage<UiPrefs, unknown>) {
  return create<UiPrefsState>()(
    persist(
      (set) => ({
        ...defaultUiPrefs(),
        setLastRepo: (lastRepo) => set({ lastRepo }),
        setLastSprint: (lastSprint) => set({ lastSprint }),
        setLastTeam: (lastTeam) => set({ lastTeam, lastSprint: null }),
        setLaneCollapsed: (lane, collapsed) =>
          set(({ collapsedLanes }) => ({
            collapsedLanes: collapsed
              ? collapsedLanes.includes(lane)
                ? collapsedLanes
                : [...collapsedLanes, lane]
              : collapsedLanes.filter((collapsedLane) => collapsedLane !== lane),
          })),
        toggleLane: (lane) =>
          set(({ collapsedLanes }) => ({
            collapsedLanes: collapsedLanes.includes(lane)
              ? collapsedLanes.filter((collapsedLane) => collapsedLane !== lane)
              : [...collapsedLanes, lane],
          })),
        setEmbedMode: (ticketId, mode) =>
          set(({ embedModeByTicket }) => ({ embedModeByTicket: { ...embedModeByTicket, [ticketId]: mode } })),
        setComposerDraft: (ticketId, draft) =>
          set(({ composerDrafts }) => {
            const next = { ...(composerDrafts ?? {}) };
            if (draft.trim() === '') delete next[ticketId];
            else next[ticketId] = draft;
            return { composerDrafts: next };
          }),
        setShowThinking: (showThinking) => set({ showThinking }),
        setTicketLayout: (ticketLayout) => set({ ticketLayout }),
        setCodeCityLegendDismissed: (codeCityLegendDismissed) => set({ codeCityLegendDismissed }),
        setAppearance: (appearance) => set({ appearance }),
      }),
      {
        name: 'ui-prefs',
        storage,
        partialize: pickPrefs,
        // Loaded on purpose by the app (hydrateUiPrefs), not as a side effect of importing this module.
        skipHydration: true,
      },
    ),
  );
}

export type UiPrefsStore = ReturnType<typeof createUiPrefsStore>;

/** Whether the output draws the agent's thinking (AL-262); shown until switched off. */
export function useShowThinking(): boolean {
  return useUiPrefs((state) => state.showThinking ?? true);
}

/** The ticket screen's layout (AL-275); Flight deck until the user picks Code City. */
export function useTicketLayout(): TicketLayout {
  return useUiPrefs((state) => state.ticketLayout ?? DEFAULT_TICKET_LAYOUT);
}

/** Whether the Code City legend card was closed (AL-275). */
export function useCodeCityLegendDismissed(): boolean {
  return useUiPrefs((state) => state.codeCityLegendDismissed ?? false);
}

/** Light, dark, or the computer's appearance. Unset follows the system. */
export function useAppearance(): Appearance {
  return useUiPrefs((state) => appearanceOf(state));
}

export const useUiPrefs: UiPrefsStore = createUiPrefsStore(createUiPrefsStorage());

/** Loads the saved prefs. Resolves once loaded, or once loading failed and the defaults stayed. */
export async function hydrateUiPrefs(store: UiPrefsStore = useUiPrefs): Promise<void> {
  await store.persist.rehydrate();
}

export function useLaneCollapsed(lane: Lane): boolean {
  return useUiPrefs((state) => state.collapsedLanes.includes(lane));
}

export function useComposerDraft(ticketId: string): string {
  return useUiPrefs((state) => state.composerDrafts?.[ticketId] ?? '');
}

export function useEmbedMode(ticketId: string): EmbedMode {
  return useUiPrefs((state) => state.embedModeByTicket[ticketId] ?? DEFAULT_EMBED_MODE);
}
