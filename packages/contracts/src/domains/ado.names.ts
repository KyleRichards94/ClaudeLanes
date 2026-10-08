/** Azure DevOps sprints, work items, comments and pull requests (AL-065). Zod-free: imported by the sandboxed preload. */
export const ADO_INVOKE_CHANNELS = [
  'ado:listSprints',
  'ado:listWorkItems',
  'ado:searchWorkItems',
  'ado:getWorkItem',
  'ado:getComments',
  'ado:createPullRequest',
  'ado:getPullRequest',
  'ado:listTeams',
  'ado:teamBoard',
  'ado:activePrs',
  'ado:backlog',
] as const;
export const ADO_EVENT_CHANNELS = [] as const;
