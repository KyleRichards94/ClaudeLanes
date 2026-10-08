import { err, ok, type AGENT_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import type { Services } from '../services';

/** The `agent:*` invoke channels (AL-100 onwards), served by the session manager. */
export function createAgentHandlers({
  sessions,
  transcripts,
  stages,
  mcpStatus,
  permissions,
  subagents,
  usage,
}: Pick<Services, 'sessions' | 'transcripts' | 'stages' | 'mcpStatus' | 'permissions' | 'subagents' | 'usage'>): HandlersFor<(typeof AGENT_INVOKE_CHANNELS)[number]> {
  return {
    'agent:getStatus': ({ ticketId }) => ok(sessions.status(ticketId)),
    'agent:getTranscript': async ({ ticketId }) => ok(await transcripts.get(ticketId)),
    'agent:resolveGate': ({ ticketId, decision, note }) => {
      if (decision === 'request-changes' && !note?.trim()) return err('VALIDATION', 'Say what the agent should change.');
      return ok({ resolved: stages.resolveGate(ticketId, decision === 'approve' ? { approve: true } : { approve: false, note: note ?? '' }) });
    },
    'agent:setGate': ({ ticketId, stage, gate }) => stages.setGate(ticketId, stage, gate),
    'agent:getGate': ({ ticketId }) => ok({ gate: stages.pendingGate(ticketId) }),
    'agent:send': ({ ticketId, text, priority }) => sessions.send(ticketId, { text, priority: priority ?? 'next' }),
    'agent:pause': ({ ticketId }) => sessions.pause(ticketId),
    'agent:resume': ({ ticketId }) => sessions.resume(ticketId),
    'agent:getUsage': ({ ticketId }) => ok(usage.get(ticketId)),
    'agent:getMcpStatus': () => ok(mcpStatus.summary()),
    'agent:resolvePermission': ({ ticketId, requestId, decision }) => ok({ resolved: permissions.resolve(ticketId, requestId, decision) }),
    'agent:getPermission': ({ ticketId }) => ok({ request: permissions.pending(ticketId) }),
    'agent:setModel': ({ ticketId, model }) => sessions.setModel(ticketId, model),
    'agent:setEffort': ({ ticketId, effort }) => sessions.setEffort(ticketId, effort),
    'agent:applyModelNow': ({ ticketId }) => sessions.applyModelNow(ticketId),
    'agent:getModel': ({ ticketId }) => sessions.modelState(ticketId),
    'agent:getSubagents': ({ ticketId }) => ok(subagents.get(ticketId)),
  };
}
