import { useRef, useState, type RefObject } from 'react';
import type { McpConnectionSummary, McpTransport } from '@agent-lanes/contracts';
import type { SecureTextFieldHandle } from '@agent-lanes/ui';
import { useDraftTest, type ConnectionDraftController, type DraftStatus, type DraftTest } from '@/entities/connection';
import { useReplaceConnection, useSaveConnection, type ConnectionDraftInput } from '@/shared/api';

export type McpTransportType = McpTransport['type'];

/**
 * Splits a command line's arguments the way a shell user expects: on spaces, keeping "quoted parts"
 * together. `-y @azure-devops/mcp "Companion Systems"` → `['-y', '@azure-devops/mcp', 'Companion Systems']`.
 */
export function splitArgs(line: string): string[] {
  const args: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of line.matchAll(pattern)) args.push(match[1] ?? match[2] ?? match[3] ?? '');
  return args;
}

/** The arguments back as one line, quoting any with spaces. */
export function joinArgs(args: readonly string[]): string {
  return args.map((arg) => (/\s/.test(arg) || arg === '' ? `"${arg}"` : arg)).join(' ');
}

export interface McpDraft extends ConnectionDraftController {
  replacing: McpConnectionSummary | null;
  name: string;
  setName(value: string): void;
  transport: McpTransportType;
  setTransport(value: McpTransportType): void;
  command: string;
  setCommand(value: string): void;
  args: string;
  setArgs(value: string): void;
  url: string;
  setUrl(value: string): void;
  /** Env var (stdio) or header (http/sse) the token goes in. */
  tokenSlot: string;
  setTokenSlot(value: string): void;
  tokenFilled: boolean;
  onTokenChange(filled: boolean): void;
  tokenRef: RefObject<SecureTextFieldHandle | null>;
  /** Why the token slot can't be used, or null. */
  slotError: string | null;
  test: DraftTest;
  canTest: boolean;
  runTest(): Promise<void>;
  startReplace(row: McpConnectionSummary): void;
  cancelReplace(): void;
  saveError: string | null;
}

/** The MCP servers tab's draft (AL-046, AL-045): name, how to reach the server, and an optional token. */
export function useMcpDraft(): McpDraft {
  const test = useDraftTest();
  const saveConnection = useSaveConnection();
  const replaceConnection = useReplaceConnection();
  const tokenRef = useRef<SecureTextFieldHandle | null>(null);
  const [replacing, setReplacing] = useState<McpConnectionSummary | null>(null);
  const [name, setNameState] = useState('');
  const [transport, setTransportState] = useState<McpTransportType>('stdio');
  const [command, setCommandState] = useState('');
  const [args, setArgsState] = useState('');
  const [url, setUrlState] = useState('');
  const [tokenSlot, setTokenSlotState] = useState('');
  const [tokenFilled, setTokenFilled] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const slot = tokenSlot.trim();
  const slotPattern = transport === 'stdio' ? /^[A-Za-z_][A-Za-z0-9_]{0,127}$/ : /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/;
  const slotError =
    slot && !slotPattern.test(slot)
      ? transport === 'stdio'
        ? 'Use an environment variable name, like GITHUB_TOKEN.'
        : 'Use an HTTP header name, like Authorization.'
      : tokenFilled && !slot
        ? transport === 'stdio'
          ? 'Say which environment variable the token goes in.'
          : 'Say which header the token goes in.'
        : null;
  const reachable = transport === 'stdio' ? command.trim() !== '' : url.trim() !== '';
  const typed = name.trim() !== '' || command.trim() !== '' || url.trim() !== '' || tokenFilled;
  const status: DraftStatus = test.state === 'passed' ? 'passed' : typed || replacing ? 'untested' : 'empty';

  function edited() {
    test.reset();
    setSaveError(null);
  }

  function edit<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      edited();
    };
  }

  function clear() {
    tokenRef.current?.clear();
    setTokenFilled(false);
    setReplacing(null);
    setNameState('');
    setTransportState('stdio');
    setCommandState('');
    setArgsState('');
    setUrlState('');
    setTokenSlotState('');
    setSaveError(null);
    test.reset();
  }

  function transportValue(): McpTransport {
    const slotOrNull = slot || null;
    return transport === 'stdio'
      ? { type: 'stdio', command: command.trim(), args: splitArgs(args), envVar: slotOrNull }
      : { type: transport, url: url.trim(), header: slotOrNull };
  }

  function draft(token: string): ConnectionDraftInput {
    return { kind: 'mcp', name: name.trim(), transport: transportValue(), ...(token ? { token } : {}) };
  }

  return {
    replacing,
    name,
    setName: edit(setNameState),
    transport,
    setTransport: edit(setTransportState),
    command,
    setCommand: edit(setCommandState),
    args,
    setArgs: edit(setArgsState),
    url,
    setUrl: edit(setUrlState),
    tokenSlot,
    setTokenSlot: edit(setTokenSlotState),
    tokenFilled,
    onTokenChange: edit(setTokenFilled),
    tokenRef,
    slotError,
    test,
    canTest: name.trim() !== '' && reachable && !slotError && test.state !== 'testing',
    async runTest() {
      setSaveError(null);
      await test.run(draft(tokenRef.current?.read() ?? ''));
    },
    startReplace(row) {
      tokenRef.current?.clear();
      setTokenFilled(false);
      setReplacing(row);
      setNameState(row.name);
      setTransportState(row.transport.type);
      if (row.transport.type === 'stdio') {
        setCommandState(row.transport.command);
        setArgsState(joinArgs(row.transport.args));
        setTokenSlotState(row.transport.envVar ?? '');
        setUrlState('');
      } else {
        setUrlState(row.transport.url);
        setTokenSlotState(row.transport.header ?? '');
        setCommandState('');
        setArgsState('');
      }
      setSaveError(null);
      test.reset();
    },
    cancelReplace: clear,
    status,
    saving: saveConnection.isPending || replaceConnection.isPending,
    saveError,
    async save() {
      if (status !== 'passed') return;
      const request = draft(tokenRef.current?.take() ?? '');
      setTokenFilled(false);
      try {
        if (replacing) await replaceConnection.mutateAsync({ id: replacing.id, draft: request });
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
