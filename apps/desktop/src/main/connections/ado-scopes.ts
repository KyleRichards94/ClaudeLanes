import { adoScopeOfRequest, type AdoLogEntry } from '@agent-lanes/ado-client';
import { REQUIRED_ADO_SCOPE_ACCESS, type AdoScope, type AdoScopeAccess, type AdoScopeCheck } from '@agent-lanes/contracts';

/**
 * What later Azure DevOps calls say about a saved token's scopes (AL-043). The connection test can
 * only read, so write access starts "verified on first write"; the first write settles it.
 */

/** The parts of an ADO client log entry (one per attempt) this needs. */
export type AdoResponseNote = Pick<AdoLogEntry, 'level' | 'method' | 'url' | 'status'>;

export interface ScopeEvidence {
  scope: AdoScope;
  access: AdoScopeAccess;
  status: 'granted' | 'missing';
}

/**
 * `granted` for a 2xx answer to a call that needs a required scope, `missing` for a 403 or a
 * sign-in page (203, or HTML the client logged as an error). Nothing for anything else: a 401 is a
 * bad or expired token (AL-048), and 404s, 5xx and timeouts say nothing about scopes.
 */
export function scopeEvidence(response: AdoResponseNote): ScopeEvidence | undefined {
  const { status } = response;
  if (status === undefined) return undefined;
  const target = adoScopeOfRequest(response.method, response.url);
  if (!target) return undefined;
  if (status === 403 || status === 203) return { ...target, status: 'missing' };
  if (status >= 200 && status < 300) return { ...target, status: response.level === 'error' ? 'missing' : 'granted' };
  return undefined;
}

/**
 * The checks with one piece of evidence applied, one per required area and access (missing entries
 * start `unverified`). Write access includes read, so a write that worked proves the read too, and
 * a refused read means no write either; a read that works again clears a write marked missing
 * because of it, back to "verified on first write".
 */
export function applyScopeEvidence(checks: readonly AdoScopeCheck[], evidence: ScopeEvidence): AdoScopeCheck[] {
  const current = REQUIRED_ADO_SCOPE_ACCESS.map(
    ({ scope, access }): AdoScopeCheck => checks.find((check) => check.scope === scope && check.access === access) ?? { scope, access, status: 'unverified' },
  );
  const readWasMissing = current.some((check) => check.scope === evidence.scope && check.access === 'read' && check.status === 'missing');
  return current.map((check): AdoScopeCheck => {
    if (check.scope !== evidence.scope) return check;
    if (check.access === evidence.access) return { ...check, status: evidence.status };
    if (evidence.access === 'write' && evidence.status === 'granted') return { ...check, status: 'granted' };
    if (evidence.access === 'read' && evidence.status === 'missing') return { ...check, status: 'missing' };
    if (evidence.access === 'read' && evidence.status === 'granted' && readWasMissing && check.status === 'missing') {
      return { ...check, status: 'unverified' };
    }
    return check;
  });
}

export function sameScopeChecks(a: readonly AdoScopeCheck[], b: readonly AdoScopeCheck[]): boolean {
  return a.length === b.length && a.every((check, index) => {
    const other = b[index];
    return other !== undefined && check.scope === other.scope && check.access === other.access && check.status === other.status;
  });
}
