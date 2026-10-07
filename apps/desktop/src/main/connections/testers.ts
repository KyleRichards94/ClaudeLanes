import type { AdoScope, ConnectionDraft, ConnectionKind } from '@agent-lanes/contracts';

/** A validated draft of one kind, with an ADO org URL already normalised. */
export type DraftOf<K extends ConnectionKind> = Extract<ConnectionDraft, { kind: K }>;

/** What a tester found. The service scrubs the token out of `identity` and `message` before they go anywhere. */
export interface ConnectionTestOutcome {
  status: 'ok' | 'error';
  identity: string | null;
  message: string | null;
  /** ADO only (AL-043). */
  missingScopes?: AdoScope[];
  /** MCP only (AL-045): names of the tools the server listed. */
  tools?: string[];
}

/**
 * Checks one draft against the real service: ADO `connectionData` (AL-043), a one-token Claude
 * request (AL-044), starting an MCP server and listing its tools (AL-045). Gets the token in the
 * draft; must not throw (a throw is reported as a failed test), and should stop when `signal` fires.
 */
export type ConnectionTester<K extends ConnectionKind> = (draft: DraftOf<K>, signal: AbortSignal) => Promise<ConnectionTestOutcome>;

/** One tester per kind; a kind without one can be saved but not tested yet. */
export type ConnectionTesters = { [K in ConnectionKind]?: ConnectionTester<K> };
