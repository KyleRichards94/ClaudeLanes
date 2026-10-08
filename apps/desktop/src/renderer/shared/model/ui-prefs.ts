import { create } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';
import { defaultUiPrefs, type EmbedMode, type Lane, type UiPrefs } from '@agent-lanes/contracts';
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
}

/** The embed mode of a ticket that has never been switched (AL-194). */
export const DEFAULT_EMBED_MODE: EmbedMode = 'webview';

function pickPrefs({ lastRepo, lastSprint, lastTeam, collapsedLanes, embedModeByTicket }: UiPrefsState): UiPrefs {
  return { lastRepo, lastSprint, lastTeam, collapsedLanes, embedModeByTicket };
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

export const useUiPrefs: UiPrefsStore = createUiPrefsStore(createUiPrefsStorage());

/** Loads the saved prefs. Resolves once loaded, or once loading failed and the defaults stayed. */
export async function hydrateUiPrefs(store: UiPrefsStore = useUiPrefs): Promise<void> {
  await store.persist.rehydrate();
}

export function useLaneCollapsed(lane: Lane): boolean {
  return useUiPrefs((state) => state.collapsedLanes.includes(lane));
}

export function useEmbedMode(ticketId: string): EmbedMode {
  return useUiPrefs((state) => state.embedModeByTicket[ticketId] ?? DEFAULT_EMBED_MODE);
}
