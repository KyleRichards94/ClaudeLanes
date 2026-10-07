/** Settings store and UI prefs (AL-041). Zod-free: imported by the sandboxed preload. */
export const SETTINGS_INVOKE_CHANNELS = ['settings:get', 'settings:update'] as const;
export const SETTINGS_EVENT_CHANNELS = [] as const;
