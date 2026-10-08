import type { DropAction, LaunchFromAdoRequest, LaunchOverrides } from '@agent-lanes/contracts';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/**
 * The Alt launch sheet (AL-240, TB§3 "can be overridden for one drop by holding Alt, which opens a
 * launch sheet before anything changes"): a drop made with Alt held waits here for the user's skills,
 * model, effort and gates. Cancel resolves null and nothing is sent to main.
 */
export interface LaunchSheetRequest {
  drop: LaunchFromAdoRequest;
  /** What the drop rules say the drop does (AL-230): the lane, its label and its default skills. */
  action: DropAction;
}

interface SheetState {
  request: LaunchSheetRequest | null;
  settle: ((overrides: LaunchOverrides | null) => void) | null;
}

const sheetStore = createStore<SheetState>()(() => ({ request: null, settle: null }));

/** Opens the sheet; resolves the user's choices, or null when they cancel. A second drop replaces the first (cancelled). */
export function openLaunchSheet(request: LaunchSheetRequest): Promise<LaunchOverrides | null> {
  sheetStore.getState().settle?.(null);
  return new Promise((resolve) => sheetStore.setState({ request, settle: resolve }));
}

/** Closes the sheet with the user's choices, or null for Cancel. */
export function closeLaunchSheet(overrides: LaunchOverrides | null): void {
  const { settle } = sheetStore.getState();
  sheetStore.setState({ request: null, settle: null });
  settle?.(overrides);
}

export function useLaunchSheetRequest(): LaunchSheetRequest | null {
  return useStore(sheetStore, (state) => state.request);
}
