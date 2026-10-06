/**
 * Typed Azure DevOps REST client (design §7). Implemented under tickets AL-040 to AL-045
 * in docs/TICKETS.md. Runs only in the Electron main process: it takes a PAT and must
 * never be imported by the renderer.
 */
export const ADO_API_VERSION = '7.1';

/** Scopes a PAT needs (design §8): Work Items (read & write), Code (read & write), Build (read). */
export const REQUIRED_PAT_SCOPES = ['vso.work_write', 'vso.code_write', 'vso.build'] as const;
