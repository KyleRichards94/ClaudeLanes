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
  'agent:setModel', // AL-106
  'agent:setEffort', // AL-106
  'agent:applyModelNow', // AL-106
  'agent:getModel', // AL-106
  'agent:getSubagents', // AL-107
  'agent:reconnect', // AL-110
  'agent:startNow', // AL-111
  'agent:launchFromAdo', // AL-236
  'agent:undoLaunch', // AL-237
  'agent:interrupt', // AL-253
  'agent:stop', // AL-253
  'agent:compact', // AL-257
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
  'agent:model', // AL-106
] as const;
