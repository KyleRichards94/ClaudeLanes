/** Azure DevOps REST version sent as `api-version` unless a call overrides it (design §7). */
export const ADO_API_VERSION = '7.1';

/** Scopes a PAT needs (design §8): Work Items (read & write), Code (read & write), Build (read). */
export const REQUIRED_PAT_SCOPES = ['vso.work_write', 'vso.code_write', 'vso.build'] as const;

/** Per-attempt request timeout, including reading the body. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Upper bound on continuation-token pages for one `list` call. */
export const DEFAULT_MAX_PAGES = 100;
