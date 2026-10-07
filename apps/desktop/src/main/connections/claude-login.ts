import { tmpdir } from 'node:os';
import type { AccountInfo, Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeLoginDetection } from '@agent-lanes/contracts';
import { ClaudeLaunchError, type ClaudeLauncher, type ClaudeQuery } from '../agent/claude-sdk';

/**
 * Finds the Claude Code login already on this computer (AL-044, design §8 "use my Claude Code login
 * when one is detected"): starts Claude Code through the Agent SDK with no API key, reads the
 * account it reports when it starts (`accountInfo()`), and stops it. No prompt is sent, so no
 * request reaches the model and nothing is billed. Claude Code keeps its own login; the app never
 * reads or stores it.
 */
export type ClaudeLoginDetector = () => Promise<ClaudeLoginDetection>;

export interface ClaudeLoginDetectorOptions {
  now?: () => Date;
  /** How long Claude Code may take to start and report its account. */
  timeoutMs?: number;
}

const DETECT_TIMEOUT_MS = 30_000;

export const NO_CLAUDE_LOGIN_MESSAGE =
  'No Claude Code login was found on this computer. Sign in to Claude Code (run claude, then /login) and check again, or use an API key.';

/**
 * Options for a short-lived check process: none of the user's settings, hooks, plugins or MCP
 * servers, no tools, a neutral folder, and no transcript left in ~/.claude/projects.
 */
export function checkProcessOptions(): Options {
  return { cwd: tmpdir(), settingSources: [], persistSession: false, tools: [], strictMcpConfig: true, mcpServers: {} };
}

/** Claude Code's `apiProvider`, as the modal names it. */
const PROVIDER_NAMES: Partial<Record<string, string>> = {
  firstParty: 'Anthropic',
  bedrock: 'Amazon Bedrock',
  vertex: 'Google Vertex AI',
  foundry: 'Microsoft Foundry',
  gateway: "your organisation's Claude gateway",
};

/** API keys Claude Code itself manages for a login: the key `/login` creates for a Claude Console account. */
const LOGIN_KEY_SOURCES = new Set(['/login managed key', 'apiKeyHelper']);

function text(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isSet(source: string | undefined): boolean {
  return text(source) !== null && source !== 'none';
}

/** `kyle@companionsystems.com.au (Companion Systems)`, or whichever half is known. */
export function claudeAccountName(email: string | null, organization: string | null): string | null {
  if (email && organization && organization !== email) return `${email} (${organization})`;
  return email ?? organization;
}

/**
 * Reads what Claude Code reported. A claude.ai login (`tokenSource`), a Console login's managed key,
 * or a cloud provider set up for Claude Code (Bedrock, Vertex, …, authenticated outside Anthropic)
 * all count as a login the app can use without a key.
 */
export function describeClaudeLogin(account: AccountInfo | undefined, checkedAt: string): ClaudeLoginDetection {
  const providerId = account?.apiProvider ?? 'firstParty';
  const provider = PROVIDER_NAMES[providerId] ?? providerId;
  const email = text(account?.email);
  const organization = text(account?.organization);
  const details = { email, organization, plan: text(account?.subscriptionType), provider, checkedAt };

  if (providerId !== 'firstParty') {
    return { ...details, found: true, identity: claudeAccountName(email, organization) ?? `Claude Code via ${provider}`, message: null };
  }
  if (isSet(account?.tokenSource) || LOGIN_KEY_SOURCES.has(account?.apiKeySource ?? '')) {
    return { ...details, found: true, identity: claudeAccountName(email, organization) ?? 'Claude Code login', message: null };
  }
  return { ...details, found: false, identity: null, message: NO_CLAUDE_LOGIN_MESSAGE };
}

/** An input stream that sends nothing and ends when `signal` fires, so the process waits without a prompt. */
function sendNothingUntil(signal: AbortSignal): AsyncIterable<SDKUserMessage> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          const done = () => resolve({ done: true, value: undefined });
          if (signal.aborted) done();
          else signal.addEventListener('abort', done, { once: true });
        }),
    }),
  };
}

/** Settles like `promise`, or rejects with a TimeoutError after `ms`. */
export function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DOMException(`${what} took longer than ${Math.round(ms / 1000)} s`, 'TimeoutError')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** The last thing Claude Code wrote to stderr, for an error message: one line, at most 300 characters. */
export function stderrTail(): { add: (chunk: string) => void; lastLine: () => string | null } {
  let tail = '';
  return {
    add: (chunk) => {
      tail = (tail + chunk).slice(-4096);
    },
    lastLine: () => {
      const line = tail
        .split(/\r?\n/)
        .map((part) => part.trim())
        .filter(Boolean)
        .pop();
      return line ? line.slice(0, 300) : null;
    },
  };
}

export function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function createClaudeLoginDetector(launcher: ClaudeLauncher, options: ClaudeLoginDetectorOptions = {}): ClaudeLoginDetector {
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? DETECT_TIMEOUT_MS;
  let running: Promise<ClaudeLoginDetection> | undefined;

  function notFound(message: string): ClaudeLoginDetection {
    return { found: false, identity: null, email: null, organization: null, plan: null, provider: null, message, checkedAt: now().toISOString() };
  }

  async function detect(): Promise<ClaudeLoginDetection> {
    const finished = new AbortController();
    const stderr = stderrTail();
    let query: ClaudeQuery;
    try {
      query = await launcher.launch({
        credential: { mode: 'login' },
        prompt: sendNothingUntil(finished.signal),
        options: { ...checkProcessOptions(), stderr: stderr.add },
      });
    } catch (cause) {
      return notFound(cause instanceof ClaudeLaunchError ? cause.message : `Claude Code could not be started: ${describeCause(cause)}`);
    }
    try {
      return describeClaudeLogin(await within(query.accountInfo(), timeoutMs, 'Starting Claude Code'), now().toISOString());
    } catch (cause) {
      const detail = stderr.lastLine();
      return notFound(`Could not check for a Claude Code login: ${describeCause(cause)}${detail ? ` (${detail})` : ''}`);
    } finally {
      finished.abort();
      query.close();
    }
  }

  // The modal may ask again while a check is running; they share one process.
  return () => {
    running ??= detect().finally(() => {
      running = undefined;
    });
    return running;
  };
}
