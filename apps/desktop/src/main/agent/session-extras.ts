import type { HookEvent, Options } from '@anthropic-ai/claude-agent-sdk';
import type { TicketRecord } from '@agent-lanes/contracts';
import type { SessionExtras } from './session-manager';

/** One contributor to a session's extras: the stage server (AL-103), the MCP servers (AL-108), … */
export type SessionExtrasSource = (record: TicketRecord) => SessionExtras | Promise<SessionExtras>;

/**
 * Asks each source in order and merges what they give into one `SessionExtras`: MCP servers by name
 * (an earlier source keeps a name a later one repeats), allowed tools without repeats, system-prompt
 * additions and first-turn sections in source order, and the first permission mode and `canUseTool`
 * given (AL-109), and SDK hooks per event, each source's matchers after the earlier ones' (AL-084
 * sub-agent worktrees, AL-107 sub-agent tracking). In order, because the stage source moves a Queued ticket to Planning before the
 * session starts.
 */
export function combineSessionExtras(sources: readonly SessionExtrasSource[]): SessionExtrasSource {
  return async (record) => {
    const mcpServers: NonNullable<SessionExtras['mcpServers']> = {};
    const allowedTools: string[] = [];
    const prompts: string[] = [];
    const appendix: string[] = [];
    let permissionMode: SessionExtras['permissionMode'];
    let canUseTool: SessionExtras['canUseTool'];
    const hooks: NonNullable<Options['hooks']> = {};
    for (const source of sources) {
      const extras = await source(record);
      for (const [name, server] of Object.entries(extras.mcpServers ?? {})) if (!(name in mcpServers)) mcpServers[name] = server;
      for (const tool of extras.allowedTools ?? []) if (!allowedTools.includes(tool)) allowedTools.push(tool);
      if (extras.systemPromptAppend) prompts.push(extras.systemPromptAppend);
      appendix.push(...(extras.firstTurnAppendix ?? []));
      permissionMode ??= extras.permissionMode;
      canUseTool ??= extras.canUseTool;
      for (const event of Object.keys(extras.hooks ?? {}) as HookEvent[]) {
        hooks[event] = [...(hooks[event] ?? []), ...(extras.hooks?.[event] ?? [])];
      }
    }
    return {
      mcpServers,
      allowedTools,
      ...(prompts.length > 0 ? { systemPromptAppend: prompts.join('\n\n') } : {}),
      firstTurnAppendix: appendix,
      ...(permissionMode ? { permissionMode } : {}),
      ...(canUseTool ? { canUseTool } : {}),
      ...(Object.keys(hooks).length > 0 ? { hooks } : {}),
    };
  };
}
