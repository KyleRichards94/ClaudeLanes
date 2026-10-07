import { useRef, useState } from 'react';
import type { ConnectionTestResult } from '@agent-lanes/contracts';
import { useTestConnection, type ConnectionDraftInput } from '@/shared/api';

/**
 * A draft row as the Connections modal's footer sees it (AL-046): `empty` (nothing typed), `untested`
 * (typed, but not passed Test connection since the last edit) or `passed`. Save waits until no draft
 * is `untested` and at least one has `passed`.
 */
export type DraftStatus = 'empty' | 'untested' | 'passed';

/** What each tab's draft gives the modal: its status, and saving or clearing it. */
export interface ConnectionDraftController {
  status: DraftStatus;
  saving: boolean;
  /** Saves the tested draft (its token goes straight to the main process), then empties the form. */
  save(): Promise<void>;
  /** Empties the form, secrets included (Cancel). */
  clear(): void;
}

/** Where a draft row's Test connection stands. Save waits for `passed` (AL-046). */
export type DraftTestState = 'idle' | 'testing' | 'passed' | 'failed';

export interface DraftTest {
  state: DraftTestState;
  /** The last finished test's result (passed or failed), null before one or after an edit. */
  result: ConnectionTestResult | null;
  /** What to show when the test failed: the tester's message, or why the request itself failed. */
  message: string | null;
  /** Tests the draft; the token goes to the main process and no further. */
  run(draft: ConnectionDraftInput): Promise<ConnectionTestResult | null>;
  /** Forgets the test: called on every edit, so Save always follows a test of what is typed now. */
  reset(): void;
}

interface TestView {
  state: DraftTestState;
  result: ConnectionTestResult | null;
  message: string | null;
}

const idle: TestView = { state: 'idle', result: null, message: null };

/** One draft row's Test connection. */
export function useDraftTest(): DraftTest {
  const testConnection = useTestConnection();
  const [view, setView] = useState<TestView>(idle);
  // Bumped on every reset and run, so a test still running when the user edits can't mark the new text as passed.
  const generation = useRef(0);

  async function run(draft: ConnectionDraftInput): Promise<ConnectionTestResult | null> {
    const mine = ++generation.current;
    setView({ state: 'testing', result: null, message: null });
    try {
      const tested = await testConnection.mutateAsync({ draft });
      if (mine !== generation.current) return null;
      setView({
        state: tested.status === 'ok' ? 'passed' : 'failed',
        result: tested,
        message: tested.status === 'ok' ? null : (tested.message ?? 'The test failed.'),
      });
      return tested;
    } catch (error) {
      if (mine !== generation.current) return null;
      setView({ state: 'failed', result: null, message: error instanceof Error ? error.message : 'The test could not run.' });
      return null;
    }
  }

  function reset() {
    generation.current += 1;
    setView((current) => (current === idle ? current : idle));
  }

  return { ...view, run, reset };
}
