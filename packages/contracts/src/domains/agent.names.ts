/** Claude Agent SDK sessions: output, stages, gates, messages, model/effort, sub-agents (AL-100–AL-115). Zod-free: imported by the sandboxed preload. */
export const AGENT_INVOKE_CHANNELS = [
  'agent:getStatus', // AL-100
  'agent:getTranscript', // AL-102
  'agent:resolveGate', // AL-104
  'agent:setGate', // AL-104
  'agent:getGate', // AL-104
  'agent:send', // AL-105
  'agent:pause', // AL-105
  'agent:resume', // AL-105
  'agent:getUsage', // AL-113
  'agent:getMcpStatus', // AL-108
  'agent:resolvePermission', // AL-109
  'agent:getPermission', // AL-109
] as const;
export const AGENT_EVENT_CHANNELS = [
  'agent:output',
  'agent:stage',
  'agent:subagent',
  'agent:gate',
  'agent:status',
  'agent:usage', // AL-113
  'agent:mcpStatus', // AL-108
  'agent:permission', // AL-109
] as const;
