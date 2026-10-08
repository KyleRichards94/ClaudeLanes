import { invoke } from './ipc';

/**
 * Reconnect on the "MCP bridge lost the session" toast (AL-110): resumes the ticket's saved session in
 * its worktree. Resolves the error message when it could not, or null when it did.
 */
export async function reconnectSession(ticketId: string): Promise<string | null> {
  const result = await invoke('agent:reconnect', { ticketId });
  return result.ok ? null : result.message;
}
