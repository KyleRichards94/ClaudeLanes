import { useRef, useState, type RefObject } from 'react';
import { ExpiryDateSchema, type AdoConnectionSummary } from '@agent-lanes/contracts';
import type { SecureTextFieldHandle } from '@agent-lanes/ui';
import { useDraftTest, type ConnectionDraftController, type DraftStatus, type DraftTest } from '@/entities/connection';
import { useReplaceConnection, useSaveConnection, type ConnectionDraftInput } from '@/shared/api';

/** Adding a new organisation, or replacing the token of a saved one (Replace, Reconnect). */
export type AdoDraftMode = { kind: 'add' } | { kind: 'replace'; row: AdoConnectionSummary };

export interface AdoDraft extends ConnectionDraftController {
  mode: AdoDraftMode;
  orgUrl: string;
  setOrgUrl(value: string): void;
  /** Free text until a test loads the projects; then one of them. */
  defaultProject: string;
  setDefaultProject(value: string): void;
  /** Optional `YYYY-MM-DD` the token stops working (Q10); ADO can't tell. */
  expiresAt: string;
  setExpiresAt(value: string): void;
  /** Why the expiry date can't be used, or null. */
  expiryError: string | null;
  /** Why the default project can't be used (not one the token can see), or null. */
  projectError: string | null;
  patFilled: boolean;
  onPatChange(filled: boolean): void;
  /** The PAT field: the secret stays in it until Test reads it or Save takes it. */
  patRef: RefObject<SecureTextFieldHandle | null>;
  test: DraftTest;
  /** Projects from the last passing test, for the Default project field. */
  projects: readonly string[] | null;
  canTest: boolean;
  runTest(): Promise<void>;
  startReplace(row: AdoConnectionSummary): void;
  cancelReplace(): void;
  /** Why the last save failed, or null. */
  saveError: string | null;
}

/** The Azure DevOps tab's draft row (AL-046, artboard 5 "Add an organisation"). */
export function useAdoDraft(): AdoDraft {
  const test = useDraftTest();
  const saveConnection = useSaveConnection();
  const replaceConnection = useReplaceConnection();
  const patRef = useRef<SecureTextFieldHandle | null>(null);
  const [mode, setMode] = useState<AdoDraftMode>({ kind: 'add' });
  const [orgUrl, setOrgUrlState] = useState('');
  const [defaultProject, setDefaultProject] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [patFilled, setPatFilled] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const projects = test.state === 'passed' ? test.result?.projects ?? null : null;
  const project = defaultProject.trim();
  const expiry = expiresAt.trim();
  const expiryError = expiry && !ExpiryDateSchema.safeParse(expiry).success ? 'Enter a date like 2027-01-12, or leave it empty.' : null;
  const projectError =
    project && projects && projects.length > 0 && !projects.includes(project) ? `The token can't see a project called "${project}".` : null;

  const typed = orgUrl.trim() !== '' || patFilled;
  const status: DraftStatus = test.state === 'passed' && !expiryError && !projectError ? 'passed' : typed || mode.kind === 'replace' ? 'untested' : 'empty';

  function edited() {
    test.reset();
    setSaveError(null);
  }

  function clear() {
    patRef.current?.clear();
    setPatFilled(false);
    setOrgUrlState('');
    setDefaultProject('');
    setExpiresAt('');
    setMode({ kind: 'add' });
    setSaveError(null);
    test.reset();
  }

  function draft(pat: string): ConnectionDraftInput {
    return {
      kind: 'ado',
      orgUrl: orgUrl.trim(),
      pat,
      defaultProject: project || null,
      expiresAt: expiry || null,
    };
  }

  return {
    mode,
    orgUrl,
    setOrgUrl(value) {
      setOrgUrlState(value);
      edited();
    },
    defaultProject,
    setDefaultProject,
    expiresAt,
    setExpiresAt,
    expiryError,
    projectError,
    patFilled,
    onPatChange(filled) {
      setPatFilled(filled);
      edited();
    },
    patRef,
    test,
    projects,
    canTest: orgUrl.trim() !== '' && patFilled && test.state !== 'testing',
    async runTest() {
      const pat = patRef.current?.read() ?? '';
      if (!pat || !orgUrl.trim()) return;
      setSaveError(null);
      const result = await test.run(draft(pat));
      // "Loaded after the token is tested": offer the first project the token can see.
      const first = result?.projects?.[0];
      if (result?.status === 'ok' && first && !project) setDefaultProject(first);
    },
    startReplace(row) {
      patRef.current?.clear();
      setPatFilled(false);
      setMode({ kind: 'replace', row });
      setOrgUrlState(row.orgUrl);
      setDefaultProject(row.defaultProject ?? '');
      setExpiresAt('');
      setSaveError(null);
      test.reset();
    },
    cancelReplace: clear,
    status,
    saving: saveConnection.isPending || replaceConnection.isPending,
    saveError,
    async save() {
      if (status !== 'passed') return;
      // Taken now: the field is empty from here on, whatever the save does (AL-027).
      const pat = patRef.current?.take() ?? '';
      setPatFilled(false);
      try {
        if (mode.kind === 'replace') await replaceConnection.mutateAsync({ id: mode.row.id, draft: draft(pat) });
        else await saveConnection.mutateAsync(draft(pat));
        clear();
      } catch (error) {
        test.reset();
        setSaveError(`${error instanceof Error ? error.message : 'Saving failed.'} Enter the token again to retry.`);
        throw error;
      }
    },
    clear,
  };
}
