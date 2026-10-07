import { useRef, useState, type RefObject } from 'react';
import type { ClaudeAuthMode } from '@agent-lanes/contracts';
import type { SecureTextFieldHandle } from '@agent-lanes/ui';
import { useDraftTest, type ConnectionDraftController, type DraftStatus, type DraftTest } from '@/entities/connection';
import { useReplaceConnection, useSaveConnection, type ConnectionDraftInput } from '@/shared/api';

export interface ClaudeDraft extends ConnectionDraftController {
  mode: ClaudeAuthMode;
  setMode(mode: ClaudeAuthMode): void;
  /** Replacing the saved Claude connection (Replace, Reconnect); there is only ever one (D222). */
  replacing: boolean;
  startReplace(): void;
  cancelReplace(): void;
  keyFilled: boolean;
  onKeyChange(filled: boolean): void;
  keyRef: RefObject<SecureTextFieldHandle | null>;
  test: DraftTest;
  canTest: boolean;
  runTest(): Promise<void>;
  saveError: string | null;
}

/** The Claude tab's draft (AL-046): use the Claude Code login on this computer, or an API key (Q4, AL-044). */
export function useClaudeDraft(): ClaudeDraft {
  const test = useDraftTest();
  const saveConnection = useSaveConnection();
  const replaceConnection = useReplaceConnection();
  const keyRef = useRef<SecureTextFieldHandle | null>(null);
  const [mode, setModeState] = useState<ClaudeAuthMode>('login');
  const [replacing, setReplacing] = useState(false);
  const [keyFilled, setKeyFilled] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The login has nothing to type, so it only holds Save back once a test has started.
  const status: DraftStatus =
    test.state === 'passed' ? 'passed' : replacing || (mode === 'api-key' && keyFilled) || test.state !== 'idle' ? 'untested' : 'empty';

  function clear() {
    keyRef.current?.clear();
    setKeyFilled(false);
    setReplacing(false);
    setSaveError(null);
    test.reset();
  }

  function draft(): ConnectionDraftInput {
    return mode === 'login' ? { kind: 'claude', mode } : { kind: 'claude', mode, apiKey: keyRef.current?.read() ?? '' };
  }

  return {
    mode,
    setMode(next) {
      if (next === mode) return;
      setModeState(next);
      setSaveError(null);
      test.reset();
    },
    replacing,
    startReplace() {
      keyRef.current?.clear();
      setKeyFilled(false);
      setReplacing(true);
      setSaveError(null);
      test.reset();
    },
    cancelReplace: clear,
    keyFilled,
    onKeyChange(filled) {
      setKeyFilled(filled);
      setSaveError(null);
      test.reset();
    },
    keyRef,
    test,
    canTest: (mode === 'login' || keyFilled) && test.state !== 'testing',
    async runTest() {
      setSaveError(null);
      await test.run(draft());
    },
    status,
    saving: saveConnection.isPending || replaceConnection.isPending,
    saveError,
    async save() {
      if (status !== 'passed') return;
      const request: ConnectionDraftInput =
        mode === 'login' ? { kind: 'claude', mode } : { kind: 'claude', mode, apiKey: keyRef.current?.take() ?? '' };
      setKeyFilled(false);
      try {
        if (replacing) await replaceConnection.mutateAsync({ id: 'claude', draft: request });
        else await saveConnection.mutateAsync(request);
        clear();
      } catch (error) {
        test.reset();
        setSaveError(error instanceof Error ? error.message : 'Saving failed.');
        throw error;
      }
    },
    clear,
  };
}
