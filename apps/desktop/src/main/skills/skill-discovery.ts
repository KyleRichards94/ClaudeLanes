import type { SDKUserMessage, SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import { err, ok, type ListSkillsResponse, type Result, type SkillInfo } from '@agent-lanes/contracts';
import { createInputQueue } from '../agent/input-queue';
import { ClaudeLaunchError, type ClaudeCredential, type ClaudeLauncher, type ClaudeQuery } from '../agent/claude-sdk';
import { CLAUDE_CONNECTION_ID, type ConnectionsService } from '../connections';
import type { Logger } from '../logging';
import { repoPathKey } from '../repos/repo-paths';
import type { SettingsService } from '../settings/service';

/**
 * Skill discovery (AL-114, artboard 2 Skills, artboard 3 shortcuts): the skills an agent in a repo can
 * run, exactly as Claude Code lists them. Main starts a short Claude Code session with the repo's
 * configuration (cwd = the repo's main checkout and the user, project and local setting sources, so
 * the repo's own `.claude/skills` and the user's skills and plugins load, D12), asks it with
 * `supportedCommands()`, and closes it. No user turn is sent, so no model request is made.
 *
 * The list is cached per repo and asked again only on `refresh`; requests that arrive while one is
 * loading share it. Claude Code's own commands (`builtin`) and MCP prompts are left out.
 */
export interface SkillDiscovery {
  list(repo: string, options?: { refresh?: boolean }): Promise<Result<ListSkillsResponse>>;
}

export interface SkillDiscoveryOptions {
  claude: ClaudeLauncher;
  connections: Pick<ConnectionsService, 'get' | 'secret'>;
  settings: Pick<SettingsService, 'get'>;
  log?: Pick<Logger, 'info' | 'warn' | 'debug'>;
  /** How long Claude Code has to answer. */
  timeoutMs?: number;
  now?: () => number;
}

export const SKILL_DISCOVERY_TIMEOUT_MS = 30_000;
export const REPO_NOT_REGISTERED_MESSAGE = 'Add the repo to Agent Lanes before listing its skills.';

/** Skills only: no Claude Code built-in commands and no MCP prompts; one per name, sorted. */
export function skillsFrom(commands: readonly SlashCommand[]): SkillInfo[] {
  const byName = new Map<string, SkillInfo>();
  for (const command of commands) {
    const name = command.name.replace(/^\//, '').trim();
    if (!name || command.builtin || name.startsWith('mcp__') || byName.has(name)) continue;
    byName.set(name, { name: name.slice(0, 200), description: (command.description ?? '').slice(0, 2000), argumentHint: (command.argumentHint ?? '').slice(0, 500) });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function createSkillDiscovery(options: SkillDiscoveryOptions): SkillDiscovery {
  const { claude, connections, settings, log } = options;
  const timeoutMs = options.timeoutMs ?? SKILL_DISCOVERY_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const cache = new Map<string, ListSkillsResponse>();
  const loading = new Map<string, Promise<Result<ListSkillsResponse>>>();

  /** The Claude connection's credential. Listing skills sends no model request, so without a connection the user's login is tried. */
  async function credential(): Promise<ClaudeCredential> {
    const summary = await connections.get(CLAUDE_CONNECTION_ID);
    if (summary?.kind === 'claude' && summary.mode === 'api-key') {
      const apiKey = await connections.secret(CLAUDE_CONNECTION_ID);
      if (apiKey !== undefined) return { mode: 'api-key', apiKey };
    }
    return { mode: 'login' };
  }

  async function load(repo: string): Promise<Result<ListSkillsResponse>> {
    const input = createInputQueue<SDKUserMessage>();
    const abortController = new AbortController();
    let query: ClaudeQuery | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      query = await claude.launch({
        credential: await credential(),
        prompt: input,
        options: {
          cwd: repo,
          settingSources: ['user', 'project', 'local'],
          abortController,
          persistSession: false,
          stderr: (data) => log?.debug(`claude (skills): ${data.trimEnd()}`),
        },
      });
      const started = query;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Claude Code did not list its skills within ${Math.round(timeoutMs / 1000)} s.`)), timeoutMs);
      });
      const commands = await Promise.race([started.supportedCommands(), timeout]);
      const response = { repo, skills: skillsFrom(commands), loadedAt: now() };
      log?.info(`Listed ${response.skills.length} skills for ${repo}`);
      return ok(response);
    } catch (error) {
      const message = error instanceof ClaudeLaunchError || error instanceof Error ? error.message : String(error);
      log?.warn(`Could not list the skills for ${repo}: ${message}`);
      return err('INTERNAL', `The skills could not be listed: ${message}`);
    } finally {
      if (timer) clearTimeout(timer);
      input.close();
      abortController.abort();
      query?.close();
    }
  }

  return {
    async list(repo, listOptions = {}) {
      const registered = settings.get().repos.find((entry) => repoPathKey(entry.path) === repoPathKey(repo));
      if (!registered) return err('VALIDATION', REPO_NOT_REGISTERED_MESSAGE);
      const key = repoPathKey(registered.path);
      const cached = cache.get(key);
      if (cached && !listOptions.refresh) return ok(cached);
      const pending = loading.get(key);
      if (pending) return pending;
      const started = load(registered.path).then((result) => {
        loading.delete(key);
        if (result.ok) cache.set(key, result.data);
        return result;
      });
      loading.set(key, started);
      return started;
    },
  };
}
