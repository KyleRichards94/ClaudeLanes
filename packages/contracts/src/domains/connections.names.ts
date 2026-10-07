/** ADO orgs, Claude and MCP connections; status only, never secrets (AL-042–AL-048). Zod-free: imported by the sandboxed preload. */
export const CONNECTIONS_INVOKE_CHANNELS = [
  'connections:list',
  'connections:test',
  'connections:save',
  'connections:replace',
  'connections:remove',
] as const;
export const CONNECTIONS_EVENT_CHANNELS = [
  'connections:changed',
] as const;
