import type * as ClaudeSdk from '@anthropic-ai/claude-agent-sdk';
import type { Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * Starting Claude Code through the Agent SDK (AL-044; AL-100 starts sessions the same way).
 *
 * The SDK runs the native `claude` binary as a child process and talks to it over stdio. Every
 * process the app starts gets its credential from the Claude connection, never from whatever the
 * app happened to inherit: see `claudeProcessEnv`.
 */

/**
 * The part of the SDK's `Query` the app uses: the message stream, the account, stopping, and the
 * streaming-input controls agent sessions use (AL-100: interrupt, model and effort changes).
 */
export type ClaudeQuery = AsyncIterable<SDKMessage> & Pick<Query, 'accountInfo' | 'close' | 'interrupt' | 'setModel' | 'applyFlagSettings'>;

export type ClaudeQueryFunction = (params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }) => ClaudeQuery;

/** How a process authenticates: the user's Claude Code login, or an API key from the Connections modal. */
export type ClaudeCredential = { mode: 'login' } | { mode: 'api-key'; apiKey: string };

/** The env var the `claude` process reads an API key from (design §8), as in connections' `sessionEnv()`. */
const ANTHROPIC_API_KEY_ENV = 'ANTHROPIC_API_KEY';

/**
 * Credentials Claude Code would use ahead of an API key. Dropped when the connection is an API key,
 * so the key the user entered is the one tested and used.
 */
const OTHER_CREDENTIAL_ENV = ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'] as const;

/** Names the app to Anthropic in the User-Agent (documented on the SDK's `env` option). */
const CLIENT_APP_ENV = 'CLAUDE_AGENT_SDK_CLIENT_APP';

/**
 * The environment for a `claude` process. The SDK replaces the child's environment with this
 * (it does not merge), so it starts from `base` (normally `process.env`), then:
 * - login: an `ANTHROPIC_API_KEY` inherited from the user's environment is removed, because Claude
 *   Code would use it instead of the login, and the user chose the login;
 * - API key: `ANTHROPIC_API_KEY` is the saved key, and other credentials Claude Code prefers are removed.
 */
export function claudeProcessEnv(base: NodeJS.ProcessEnv, credential: ClaudeCredential, clientApp?: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) if (value !== undefined) env[name] = value;
  // Windows env names are case-insensitive, so a differently cased copy would still be read.
  const drop = new Set([ANTHROPIC_API_KEY_ENV, ...(credential.mode === 'api-key' ? OTHER_CREDENTIAL_ENV : [])]);
  for (const name of Object.keys(env)) if (drop.has(name.toUpperCase())) delete env[name];
  if (credential.mode === 'api-key') env[ANTHROPIC_API_KEY_ENV] = credential.apiKey;
  if (clientApp) env[CLIENT_APP_ENV] = clientApp;
  return env;
}

export type ClaudeLaunchErrorCode = 'NOT_INSTALLED' | 'SDK_UNAVAILABLE';

/** Claude Code could not be started at all. The message is for the user and holds no credential. */
export class ClaudeLaunchError extends Error {
  readonly code: ClaudeLaunchErrorCode;

  constructor(code: ClaudeLaunchErrorCode, message: string) {
    super(message);
    this.name = 'ClaudeLaunchError';
    this.code = code;
  }
}

export interface ClaudeLaunchRequest {
  credential: ClaudeCredential;
  prompt: string | AsyncIterable<SDKUserMessage>;
  /** SDK options; `pathToClaudeCodeExecutable` and `env` are set by the launcher. */
  options?: Omit<Options, 'pathToClaudeCodeExecutable' | 'env'>;
}

export interface ClaudeLauncher {
  /** Starts a `claude` process. Rejects with a `ClaudeLaunchError` when the binary or the SDK is missing. */
  launch(request: ClaudeLaunchRequest): Promise<ClaudeQuery>;
  /**
   * Closes every `claude` process this launcher started that is still open: sessions, design reads,
   * login checks and connection tests alike (app quit, AL-213). Returns how many it closed.
   */
  closeAll(): number;
}

export interface ClaudeLauncherOptions {
  /** The `claude` binary (AL-007's `resolveClaudeExecutable`); null when the SDK's platform package is missing. */
  executable: () => string | null;
  /** The SDK's `query`; loaded on first use by default. Tests pass a fake, so no real process starts. */
  query?: () => ClaudeQueryFunction | Promise<ClaudeQueryFunction>;
  /** The environment processes start from; `process.env` by default. */
  baseEnv?: () => NodeJS.ProcessEnv;
  /** `agent-lanes/<version>`, sent as `CLAUDE_AGENT_SDK_CLIENT_APP`. */
  clientApp?: string;
}

let sdkQuery: Promise<ClaudeQueryFunction> | undefined;

/**
 * The SDK's `query`, imported on first use. The SDK is an ES module and the main bundle is CommonJS,
 * so it is a dynamic `import()`, which electron-vite leaves as is for an external dependency.
 */
export function loadClaudeQuery(): Promise<ClaudeQueryFunction> {
  sdkQuery ??= import('@anthropic-ai/claude-agent-sdk').then(
    (sdk) => sdk.query,
    (cause: unknown) => {
      sdkQuery = undefined;
      throw cause;
    },
  );
  return sdkQuery;
}

/** The whole SDK module, imported on first use: `createSdkMcpServer` (AL-103) and `getSessionMessages` (AL-102). */
export type ClaudeSdkModule = typeof ClaudeSdk;

let sdkModule: Promise<ClaudeSdkModule> | undefined;

export function loadClaudeSdk(): Promise<ClaudeSdkModule> {
  sdkModule ??= import('@anthropic-ai/claude-agent-sdk').catch((cause: unknown) => {
    sdkModule = undefined;
    throw cause;
  });
  return sdkModule;
}

export function createClaudeLauncher(options: ClaudeLauncherOptions): ClaudeLauncher {
  const loadQuery = options.query ?? loadClaudeQuery;
  const baseEnv = options.baseEnv ?? (() => process.env);
  // Each process until it is closed, so quitting can close the ones a caller has not.
  const open = new Set<ClaudeQuery>();

  return {
    closeAll() {
      const closing = [...open];
      open.clear();
      for (const query of closing) {
        try {
          query.close();
        } catch {
          // Already gone: nothing left to stop.
        }
      }
      return closing.length;
    },

    async launch({ credential, prompt, options: sdkOptions }) {
      const executable = options.executable();
      if (!executable) {
        throw new ClaudeLaunchError(
          'NOT_INSTALLED',
          "Claude Code isn't installed with this copy of Agent Lanes (the Agent SDK's claude binary is missing). Reinstall Agent Lanes.",
        );
      }
      let query: ClaudeQueryFunction;
      try {
        query = await loadQuery();
      } catch (cause) {
        throw new ClaudeLaunchError('SDK_UNAVAILABLE', `The Claude Agent SDK could not be loaded: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      const started = query({
        prompt,
        options: { ...sdkOptions, pathToClaudeCodeExecutable: executable, env: claudeProcessEnv(baseEnv(), credential, options.clientApp) },
      });
      open.add(started);
      const close = started.close.bind(started);
      started.close = () => {
        open.delete(started);
        close();
      };
      return started;
    },
  };
}
