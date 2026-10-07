import {
  ADO_SCOPES,
  REQUIRED_ADO_SCOPE_ACCESS,
  type AdoConnectionSummary,
  type AdoScope,
  type AdoScopeAccess,
  type AdoScopeCheck,
} from './connections.schemas';

/**
 * What the Connections modal says about an Azure DevOps connection (AL-043, artboard 5): the saved
 * row's detail line, the token expiry (Q10) and the Work Items / Code / Build scope chips. Pure
 * functions over the status rows and test results, so the modal (AL-046) and the tests share them.
 */

/** The scope chips' labels on artboard 5. */
export const ADO_SCOPE_LABELS: Readonly<Record<AdoScope, string>> = {
  'work-items': 'Work Items',
  code: 'Code',
  build: 'Build',
};

function requiredAccess(scope: AdoScope): AdoScopeAccess[] {
  return REQUIRED_ADO_SCOPE_ACCESS.filter((required) => required.scope === scope).map((required) => required.access);
}

/** "Work Items (read & write)", "Build (read)": what design §8 says the token needs for an area. */
export function adoScopeRequirement(scope: AdoScope): string {
  return `${ADO_SCOPE_LABELS[scope]} (${requiredAccess(scope).join(' & ')})`;
}

// ---- token expiry (Q10) ----------------------------------------------------------------------

/** Q10: a token's row warns from this many days before its expiry date. */
export const TOKEN_EXPIRY_WARNING_DAYS = 7;

/** `unknown`: no date was entered (ADO doesn't tell a PAT its own expiry). */
export type TokenExpiryState = 'unknown' | 'ok' | 'soon' | 'expired';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const DAY_MS = 86_400_000;
/** A date this close to today (either way) is shown without its year: "12 Jan". */
const DAYS_SHOWN_WITHOUT_YEAR = 183;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function parseIsoDate(value: string): CalendarDate | undefined {
  const match = ISO_DATE.exec(value);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return undefined;
  return { year, month, day };
}

/** Days from the user's local today to the date; negative once it has passed. */
function daysFromToday(date: CalendarDate, now: Date): number {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((Date.UTC(date.year, date.month - 1, date.day) - today) / DAY_MS);
}

/**
 * Where a token's expiry date stands on the user's local calendar. The date is the last day the
 * token works: `soon` from {@link TOKEN_EXPIRY_WARNING_DAYS} days before it through the day itself,
 * `expired` from the day after.
 */
export function tokenExpiryState(expiresAt: string | null | undefined, now: Date): TokenExpiryState {
  const date = expiresAt ? parseIsoDate(expiresAt) : undefined;
  if (!date) return 'unknown';
  const days = daysFromToday(date, now);
  if (days < 0) return 'expired';
  return days <= TOKEN_EXPIRY_WARNING_DAYS ? 'soon' : 'ok';
}

/** "expires 12 Jan", "expires 3 Mar 2028", "expires today", "expired 2 Oct"; null when no date is known. */
export function formatTokenExpiry(expiresAt: string | null | undefined, now: Date): string | null {
  const date = expiresAt ? parseIsoDate(expiresAt) : undefined;
  if (!date) return null;
  const days = daysFromToday(date, now);
  if (days === 0) return 'expires today';
  const sameYear = date.year === now.getFullYear();
  const label = `${date.day} ${MONTHS[date.month - 1]}${sameYear || Math.abs(days) <= DAYS_SHOWN_WITHOUT_YEAR ? '' : ` ${date.year}`}`;
  return days < 0 ? `expired ${label}` : `expires ${label}`;
}

// ---- the saved row -----------------------------------------------------------------------------

/** `https://dev.azure.com/CompanionSystems` → `dev.azure.com/CompanionSystems`, as the row shows it. */
export function displayOrgUrl(orgUrl: string): string {
  return orgUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/**
 * The saved row's second line on artboard 5:
 * "dev.azure.com/CompanionSystems · signed in as Kyle Richards · token ••••••••7Fq2 · expires 12 Jan".
 * Parts that aren't known (no passing test yet, no token, no expiry date) are left out.
 */
export function formatAdoConnectionDetails(
  row: Pick<AdoConnectionSummary, 'orgUrl' | 'identity' | 'maskedToken' | 'expiresAt'>,
  now: Date,
): string {
  return [
    displayOrgUrl(row.orgUrl),
    row.identity ? `signed in as ${row.identity}` : null,
    row.maskedToken ? `token ${row.maskedToken}` : null,
    formatTokenExpiry(row.expiresAt, now),
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');
}

// ---- scope chips -------------------------------------------------------------------------------

/**
 * One chip under the token field. `untested` before a test; `missing` when any access the area
 * needs was refused; `granted` once reading works (write access may still be "verified on first
 * write"); `unverified` when the read check could not run.
 */
export type AdoScopeChipState = 'untested' | 'granted' | 'missing' | 'unverified';

export interface AdoScopeChip {
  scope: AdoScope;
  /** "Work Items", "Code", "Build". */
  label: string;
  state: AdoScopeChipState;
  /** For a tooltip or the accessible name: "read ok · write verified on first write", "needs read". */
  detail: string;
}

function accessDetail(check: AdoScopeCheck): string {
  if (check.status === 'granted') return `${check.access} ok`;
  if (check.status === 'missing') return `${check.access} missing`;
  return check.access === 'write' ? 'write verified on first write' : `${check.access} not checked`;
}

/** The Work Items, Code and Build chips from a test result's `scopes` (empty → all untested). */
export function adoScopeChips(checks: readonly AdoScopeCheck[]): AdoScopeChip[] {
  return ADO_SCOPES.map((scope) => {
    const label = ADO_SCOPE_LABELS[scope];
    const mine = requiredAccess(scope).flatMap((access) => checks.filter((check) => check.scope === scope && check.access === access).slice(0, 1));
    if (mine.length === 0) return { scope, label, state: 'untested', detail: `needs ${requiredAccess(scope).join(' & ')}` };
    const state: AdoScopeChipState = mine.some((check) => check.status === 'missing')
      ? 'missing'
      : mine.find((check) => check.access === 'read')?.status === 'granted'
        ? 'granted'
        : 'unverified';
    return { scope, label, state, detail: mine.map(accessDetail).join(' · ') };
  });
}
