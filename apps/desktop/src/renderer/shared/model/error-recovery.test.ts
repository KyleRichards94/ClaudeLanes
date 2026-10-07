import { afterEach, describe, expect, it } from 'vitest';
import { ERROR_CODES, type ErrorCode } from '@agent-lanes/contracts';
import { ERROR_TITLES, filesIn, recoveryFor, showErrorRecovery, type Recovery } from './error-recovery';
import { clearToasts, getToasts } from './toasts';

afterEach(() => clearToasts());

const CONTEXT = { ticketId: '71273', connectionId: 'ado:contoso' } as const;

/** Design §12 / AL-211: the recovery each code gets when the ticket and connection are known. */
const EXPECTED: Record<ErrorCode, Recovery> = {
  ADO_UNAUTHORIZED: { kind: 'open-connections', label: 'Reconnect', connectionId: 'ado:contoso' },
  ADO_SCOPE_MISSING: { kind: 'open-connections', label: 'Open Connections', connectionId: 'ado:contoso' },
  SESSION_LOST: { kind: 'reconnect-session', label: 'Reconnect', ticketId: '71273' },
  BUILD_FAILED: { kind: 'open-ticket-tab', label: 'Open build log', ticketId: '71273', tab: 'build-log' },
  MERGE_CONFLICT: { kind: 'open-ticket-tab', label: 'View conflicts', ticketId: '71273', tab: 'diff' },
  GIT_DIRTY: { kind: 'open-ticket-tab', label: 'Review changes', ticketId: '71273', tab: 'diff' },
  VALIDATION: { kind: 'copy-diagnostics', label: 'Copy diagnostics' },
  INTERNAL: { kind: 'copy-diagnostics', label: 'Copy diagnostics' },
};

describe('error recovery map (AL-211)', () => {
  it('covers every error code', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...ERROR_CODES].sort());
    expect(Object.keys(ERROR_TITLES).sort()).toEqual([...ERROR_CODES].sort());
  });

  it.each(ERROR_CODES)('%s has its defined recovery', (code) => {
    expect(recoveryFor(code, CONTEXT)).toEqual(EXPECTED[code]);
  });

  it('opens Connections on the ADO tab when the organisation is not known', () => {
    expect(recoveryFor('ADO_UNAUTHORIZED')).toEqual({ kind: 'open-connections', label: 'Reconnect', connectionId: null });
  });

  it.each(['SESSION_LOST', 'BUILD_FAILED', 'MERGE_CONFLICT', 'GIT_DIRTY'] as const)('falls back to Copy diagnostics for %s without a ticket', (code) => {
    expect(recoveryFor(code)).toEqual({ kind: 'copy-diagnostics', label: 'Copy diagnostics' });
  });

  it('treats an unknown code as INTERNAL', () => {
    expect(recoveryFor('SOMETHING_NEW', CONTEXT)).toEqual(EXPECTED.INTERNAL);
  });
});

describe('showErrorRecovery', () => {
  it('raises an error toast whose button is the code’s recovery, for the ticket', () => {
    showErrorRecovery({ code: 'BUILD_FAILED', message: 'Build failed · 3 errors' }, { ticketId: '71273' });
    expect(getToasts()).toEqual([
      expect.objectContaining({
        id: 'error:BUILD_FAILED:71273',
        tone: 'error',
        title: 'The build failed',
        body: 'Build failed · 3 errors',
        actions: [{ label: 'Open build log', intent: { type: 'recover', code: 'BUILD_FAILED', ticketId: '71273' } }],
      }),
    ]);
  });

  it('takes the organisation from an Azure DevOps error’s details', () => {
    showErrorRecovery({ code: 'ADO_UNAUTHORIZED', message: 'The token was refused.', details: { reason: 'reconnect', org: 'ado:contoso' } });
    expect(getToasts()[0]).toMatchObject({
      id: 'error:ADO_UNAUTHORIZED:ado:contoso',
      actions: [{ label: 'Reconnect', intent: { type: 'recover', code: 'ADO_UNAUTHORIZED', connectionId: 'ado:contoso' } }],
    });
  });

  it('lists the files of a conflict or uncommitted changes', () => {
    const files = Array.from({ length: 8 }, (_, index) => `src/File${index}.cs`);
    showErrorRecovery({ code: 'MERGE_CONFLICT', message: 'Merging conflicts in 9 file(s).', details: { files, fileCount: 9 } }, { ticketId: '71273' });
    expect(getToasts()[0]?.body).toBe(
      'Merging conflicts in 9 file(s). Files: src/File0.cs, src/File1.cs, src/File2.cs, src/File3.cs, src/File4.cs and 4 more.',
    );
    expect(filesIn({ files: ['a.cs'] })).toBe('a.cs');
    expect(filesIn({ files: [] })).toBeUndefined();
    expect(filesIn('nope')).toBeUndefined();
  });

  it('shows the details of a VALIDATION or INTERNAL error with Copy diagnostics', () => {
    showErrorRecovery({ code: 'INTERNAL', message: 'Unexpected payload from git:status' });
    expect(getToasts()[0]).toMatchObject({
      title: 'Something went wrong',
      body: 'Unexpected payload from git:status',
      actions: [{ label: 'Copy diagnostics', intent: { type: 'recover', code: 'INTERNAL' } }],
    });
  });

  it('shows a repeated error once, and an unknown code as INTERNAL', () => {
    showErrorRecovery({ code: 'GIT_DIRTY', message: 'one' }, { ticketId: '71273' });
    showErrorRecovery({ code: 'GIT_DIRTY', message: 'two' }, { ticketId: '71273' });
    showErrorRecovery({ code: 'WHAT', message: 'odd' });
    expect(getToasts().map((entry) => [entry.id, entry.body])).toEqual([
      ['error:GIT_DIRTY:71273', 'two'],
      ['error:INTERNAL:', 'odd'],
    ]);
  });
});
