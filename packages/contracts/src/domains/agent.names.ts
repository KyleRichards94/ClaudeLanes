/** Claude Agent SDK sessions: output, stages, gates, messages, model/effort, sub-agents (AL-100–AL-115). Zod-free: imported by the sandboxed preload. */
export const AGENT_INVOKE_CHANNELS = [
  'agent:getStatus', // AL-100
  'agent:getTranscript', // AL-102
] as const;
export const AGENT_EVENT_CHANNELS = [
  'agent:output',
  'agent:stage',
  'agent:subagent',
  'agent:gate',
  'agent:status',
] as const;
