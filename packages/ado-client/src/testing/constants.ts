/**
 * The organisation the ado-client unit tests talk to. In its own file so fixtures that the shared
 * `./testing` entry re-exports don't pull in `msw-server.ts`, which needs Vitest (AL-065).
 */
export const ORG_URL = 'https://dev.azure.com/contoso';
