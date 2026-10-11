import { SESSION_ENDED_BY_USER_MESSAGE, err, ok, type AGENT_INVOKE_CHANNELS, type AgentSessionState } from '@agent-lanes/contracts';

import { LANE_LABELS } from './stages/stage-rules';

/** Session states with a `claude` process that takes messages. */
const LIVE_SESSION_STATES: ReadonlySet<AgentSessionState> = new Set(['starting', 'running', 'idle', 'paused']);
import type { HandlersFor } from '../ipc/handle-invoke';
import type { Services } from '../services';

/** What Compact sends (AL-257): Claude Code's own slash command, typed as the next turn. */
export const COMPACT_COMMAND = '/compact';

/** The `agent:*` invoke channels (AL-100 onwards), served by the session manager. */
export function createAgentHandlers({
  sessions,
  transcripts,
  stages,
  mcpStatus,
  permissions,
  subagents,
  usage,
  recovery,
  launches,
  adoLauncher,
  launchUndo,
  planLimits,
  tickets,
  nextActions,
}: Pick<Services, 'sessions' | 'transcripts' | 'stages' | 'mcpStatus' | 'permissions' | 'subagents' | 'usage' | 'recovery' | 'launches' | 'adoLauncher' | 'launchUndo' | 'planLimits' | 'tickets' | 'nextActions'>): HandlersFor<(typeof AGENT_INVOKE_CHANNELS)[number]> {
  return {
    // A queued ticket reads as `queued` with "Waiting for a free slot" (AL-111).
    'agent:getStatus': ({ ticketId }) => ok(launches.status(ticketId)),
    'agent:getTranscript': async ({ ticketId }) => ok(await transcripts.get(ticketId)),
    'agent:resolveGate': ({ ticketId, decision, note }) => {
      if (decision === 'request-changes' && !note?.trim()) return err('VALIDATION', 'Say what the agent should change.');
      return ok({ resolved: stages.resolveGate(ticketId, decision === 'approve' ? { approve: true } : { approve: false, note: note ?? '' }) });
    },
    'agent:setGate': ({ ticketId, stage, gate }) => stages.setGate(ticketId, stage, gate),
    'agent:getGate': ({ ticketId }) => ok({ gate: stages.pendingGate(ticketId) }),
    // A `/skill` on its own line is a skill chip or a typed command; anything else the user wrote (AL-251).
    'agent:send': async ({ ticketId, text, priority, attachments }) => {
      const message = { text, priority: priority ?? 'next', source: (/^\/\S+(?:\s[^\n]*)?$/.test(text.trim()) ? 'skill' : 'composer') as 'skill' | 'composer', ...(attachments ? { attachments } : {}) };
      const status = launches.status(ticketId);
      if (LIVE_SESSION_STATES.has(status.state)) return sessions.send(ticketId, message);
      if (status.state === 'queued') return err('VALIDATION', 'The agent is waiting for a free slot; send again once it has started.');
      // AL-268: a ticket whose agent ended, was lost or never ran takes the message anyway.
      if (status.sessionId) {
        const resumed = await recovery.reconnect(ticketId);
        if (resumed.ok) return resumed.data.state === 'queued' ? err('VALIDATION', 'The agent is waiting for a free slot; send again once it has started.') : sessions.send(ticketId, message);
        // The SDK would not resume it (its session file is gone): a fresh session takes the message as its job.
        const cleared = await tickets.update(ticketId, (record) => ({ ...record, sessionId: null }));
        if (!cleared.ok) return cleared;
      }
      const started = await launches.launch({ ticketId, jobDescription: text, firstTurnSource: message.source, firstTurnEcho: text });
      return started.ok ? ok({ held: false }) : started;
    },
    'agent:listCommands': async ({ ticketId }) => {
      const commands = await sessions.supportedCommands(ticketId);
      return commands.ok ? ok({ ticketId, commands: commands.data }) : commands;
    },
    'agent:pause': ({ ticketId }) => sessions.pause(ticketId),
    'agent:resume': ({ ticketId }) => sessions.resume(ticketId),
    'agent:getUsage': ({ ticketId }) => ok(usage.get(ticketId)),
    'agent:getPlanLimits': () => ok(planLimits.get()),
    'agent:getMcpStatus': () => ok(mcpStatus.summary()),
    'agent:resolvePermission': ({ ticketId, requestId, decision, reason, rule }) =>
      ok({ resolved: permissions.resolve(ticketId, requestId, decision, { ...(reason ? { reason } : {}), ...(rule ? { rule } : {}) }) }),
    'agent:getPermission': ({ ticketId }) => ok({ request: permissions.pending(ticketId) }),
    'agent:setModel': ({ ticketId, model }) => sessions.setModel(ticketId, model),
    'agent:setEffort': ({ ticketId, effort }) => sessions.setEffort(ticketId, effort),
    'agent:applyModelNow': ({ ticketId }) => sessions.applyModelNow(ticketId),
    'agent:getModel': ({ ticketId }) => sessions.modelState(ticketId),
    // Move to stage (AL-270, AL-274): the user's own lane move; a live agent is told at its next turn.
    'agent:moveStage': async ({ ticketId, stage }) => {
      const moved = await stages.moveTo(ticketId, stage);
      if (!moved.ok) return moved;
      if (moved.data.changed && LIVE_SESSION_STATES.has(sessions.status(ticketId).state)) {
        sessions.send(ticketId, { text: `[Agent Lanes · stage] The user moved this ticket to ${LANE_LABELS[stage]}. Carry on from that stage; report it with set_stage only when you move it again.`, shouldQuery: false, source: 'app-note' });
      }
      return ok({ from: moved.data.from, to: moved.data.to, changed: moved.data.changed });
    },
    'agent:getSubagents': ({ ticketId }) => ok(subagents.get(ticketId)),
    // Next actions for the board digest (AL-272).
    'agent:nextActions': (request) => nextActions.generate(request),
    // Stop one sub-agent (AL-261): its SDK task is stopped; the lead agent's turn goes on.
    'agent:stopSubagent': async ({ ticketId, nodeId }) => {
      const node = subagents.get(ticketId).nodes.find((entry) => entry.id === nodeId);
      if (!node) return err('VALIDATION', `Ticket ${ticketId} has no sub-agent ${nodeId}.`);
      if (!node.taskId || node.status === 'done' || node.status === 'failed') return ok({ stopped: false });
      const stopped = await sessions.stopTask(ticketId, node.taskId);
      return stopped.ok ? ok({ stopped: true }) : stopped;
    },
    'agent:reconnect': ({ ticketId }) => recovery.reconnect(ticketId),
    'agent:startNow': ({ ticketId }) => launches.startNow(ticketId),
    'agent:launchFromAdo': (request) => adoLauncher.launch(request),
    'agent:undoLaunch': ({ undoId }) => launchUndo.undo(undoId),
    // Stop turn (AL-253): like Pause's interrupt, without holding later messages.
    'agent:interrupt': async ({ ticketId }) => {
      const interrupted = await sessions.interrupt(ticketId);
      return interrupted.ok ? ok(launches.status(ticketId)) : interrupted;
    },
    // Compact (AL-257): Claude Code runs /compact as a slash command from the next user turn.
    'agent:compact': ({ ticketId }) => sessions.send(ticketId, { text: COMPACT_COMMAND, priority: 'next', source: 'app' }),
    // End session (AL-253): a queued launch is taken out of the queue; a live session is closed.
    'agent:stop': async ({ ticketId }) => {
      const dequeued = launches.cancel(ticketId);
      const stopped = await sessions.stop(ticketId, { reason: SESSION_ENDED_BY_USER_MESSAGE });
      if (!stopped.ok) return stopped;
      return ok({ stopped: stopped.data || dequeued, status: launches.status(ticketId) });
    },
  };
}
