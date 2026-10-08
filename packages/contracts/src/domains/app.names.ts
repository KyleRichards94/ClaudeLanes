/** Application info, notices and diagnostics (AL-011, AL-012, AL-030, AL-214). Zod-free: imported by the sandboxed preload. */
export const APP_INVOKE_CHANNELS = [
  'app:getInfo',
  'app:getDiagnostics',
  'app:copyDiagnostics',
  'app:logError',
  'app:popOutBacklog', // AL-239: the Backlog popout in its own window
] as const;
export const APP_EVENT_CHANNELS = [
  'toast',
  'app:window', // AL-066: the main window was minimised, hidden or shown again
] as const;
