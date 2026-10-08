import { randomUUID } from 'node:crypto';
import type { CanUseTool, PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import {
  PERMISSION_TEXT_LIMIT,
  agentPermissionPolicy,
  type PermissionDecision,
  type PermissionRequest,
  type TicketRecord,
} from '@agent-lanes/contracts';
import { userInfo } from 'node:os';
import type { BuildCommands } from '../../build/commands';
import type { Emit } from '../../ipc/emit';
import type { Logger } from '../../logging';
import type { SettingsService } from '../../settings/service';
import type { TranscriptService } from '../output/transcript';
import type { SessionExtras } from '../session-manager';
import { firstName } from '../stages/stage-service';
import { allowedBashPrefixes, bashAllowRules, bashCommandAllowed } from './policy';

/**
 * Permissions of headless sessions (AL-109, design §4, Q9, Decision D18). A ticket's session runs
 * with `acceptEdits` (unless the policy asks for every edit), Bash rules for git read commands and the
 * repo's build and test commands, and `canUseTool` for everything else. `canUseTool` never answers on
 * its own: the request is shown on the card ("Needs you · allow Bash", `agent:permission`), stays
 * readable through `agent:getPermission`, and waits for Allow once / Allow for this ticket / Deny. So
 * no session ever waits on a prompt nobody can see. Each answer is written to the ticket's output.
 */
export interface PermissionService {
  /** The permission part of a ticket session's options; see `combineSessionExtras`. */
  sessionExtras(record: TicketRecord): Promise<SessionExtras>;
  /** The session's `canUseTool` for one ticket. */
  canUseTool(ticketId: string): CanUseTool;
  /** The user's answer (`agent:resolvePermission`); false when that request no longer waits. */
  resolve(ticketId: string, requestId: string, decision: PermissionDecision): boolean;
  /** The ticket's oldest waiting request (`agent:getPermission`). */
  pending(ticketId: string): PermissionRequest | null;
  /** The session ended: every request it left waiting is cancelled. */
  cancelAll(ticketId: string): void;
}

export interface PermissionServiceOptions {
  settings: Pick<SettingsService, 'get'>;
  buildCommands: Pick<BuildCommands, 'forRepo'>;
  emit: Emit;
  transcripts?: Pick<TranscriptService, 'appendSystem'>;
  log?: Pick<Logger, 'info' | 'warn'>;
  /** Who answers on this computer, for "Kyle allowed Bash once". */
  userName?: () => string;
  now?: () => number;
  newId?: () => string;
}

/** What the agent reads when the user says no. */
export const PERMISSION_DENIED_MESSAGE = 'The user denied this in Agent Lanes. Do not retry it; find another way or explain what you need in your reply.';
export const PERMISSION_CANCELLED_MESSAGE = 'The permission request was cancelled because the turn ended.';

interface Waiting {
  request: PermissionRequest;
  /** What "Allow for this ticket" remembers. */
  rule: string;
  suggestions: PermissionUpdate[];
  settle: (result: PermissionResult) => void;
}

function clip(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > PERMISSION_TEXT_LIMIT ? `${line.slice(0, PERMISSION_TEXT_LIMIT - 1)}…` : line;
}

/** `mcp__azure-devops__wit_update_work_item` → `azure-devops · wit_update_work_item`. */
export function toolLabel(toolName: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(toolName);
  return mcp ? `${mcp[1]} · ${mcp[2]}` : toolName;
}

/** The command, path, URL or query a tool call is about, for the request's mono line. */
export function toolDetail(input: Record<string, unknown>, blockedPath?: string): string | null {
  for (const key of ['command', 'file_path', 'notebook_path', 'path', 'url', 'query', 'pattern']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return clip(value);
  }
  return blockedPath ? clip(blockedPath) : null;
}

/** What "Allow for this ticket" covers: the exact Bash command, or the whole tool for any other tool. */
function ruleFor(toolName: string, input: Record<string, unknown>): string {
  return toolName === 'Bash' && typeof input['command'] === 'string' ? `Bash:${input['command'].trim()}` : toolName;
}

function osUserName(): string {
  try {
    return firstName(userInfo().username);
  } catch {
    return 'You';
  }
}

export function createPermissionService(options: PermissionServiceOptions): PermissionService {
  const { emit, log } = options;
  const now = options.now ?? Date.now;
  const newId = options.newId ?? randomUUID;
  const userName = options.userName ?? osUserName;
  const waiting = new Map<string, Waiting[]>();
  const allowedForTicket = new Map<string, Set<string>>();
  const bashPrefixes = new Map<string, string[]>();

  const oldest = (ticketId: string): PermissionRequest | null => waiting.get(ticketId)?.[0]?.request ?? null;

  function finish(ticketId: string, entry: Waiting, state: 'allowed' | 'denied' | 'cancelled', result: PermissionResult): void {
    const list = waiting.get(ticketId) ?? [];
    const index = list.indexOf(entry);
    if (index === -1) return;
    list.splice(index, 1);
    if (list.length === 0) waiting.delete(ticketId);
    entry.settle(result);
    emit('agent:permission', { ticketId, state, request: entry.request, waiting: oldest(ticketId) });
  }

  function ask(ticketId: string, toolName: string, input: Record<string, unknown>, context: Parameters<CanUseTool>[2]): Promise<PermissionResult> {
    const label = toolLabel(toolName);
    const request: PermissionRequest = {
      requestId: newId(),
      tool: clip(label) || 'tool',
      title: clip(context.title ?? `Claude wants to use ${context.displayName ?? label}`),
      detail: toolDetail(input, context.blockedPath),
      openedAt: now(),
    };
    return new Promise<PermissionResult>((resolve) => {
      const entry: Waiting = {
        request,
        rule: ruleFor(toolName, input),
        // "Allow for this ticket" is remembered by the session only, never in a settings file in the worktree.
        suggestions: (context.suggestions ?? []).map((update) => ({ ...update, destination: 'session' }) as PermissionUpdate),
        settle: resolve,
      };
      const list = waiting.get(ticketId) ?? [];
      list.push(entry);
      waiting.set(ticketId, list);
      emit('agent:permission', { ticketId, state: 'waiting', request, waiting: oldest(ticketId) });
      log?.info(`Ticket ${ticketId} asks to use ${label}`);
      const cancel = () => {
        if (!(waiting.get(ticketId) ?? []).includes(entry)) return;
        options.transcripts?.appendSystem(ticketId, `Permission request for ${label} cancelled · the turn ended`);
        finish(ticketId, entry, 'cancelled', { behavior: 'deny', message: PERMISSION_CANCELLED_MESSAGE });
      };
      if (context.signal.aborted) cancel();
      else context.signal.addEventListener('abort', cancel, { once: true });
    });
  }

  function canUseTool(ticketId: string): CanUseTool {
    return async (toolName, input, context) => {
      if (toolName === 'Bash' && typeof input['command'] === 'string' && bashCommandAllowed(input['command'], bashPrefixes.get(ticketId) ?? [])) {
        return { behavior: 'allow', updatedInput: input };
      }
      if (allowedForTicket.get(ticketId)?.has(ruleFor(toolName, input))) return { behavior: 'allow', updatedInput: input };
      return ask(ticketId, toolName, input, context);
    };
  }

  return {
    async sessionExtras(record) {
      const policy = agentPermissionPolicy(options.settings.get());
      const commands = policy.buildAndTest ? await options.buildCommands.forRepo(record.repo, { dir: record.worktreePath }) : null;
      if (commands && !commands.ok) log?.warn(`No build or test commands for ticket ${record.id}: ${commands.message}`);
      const prefixes = allowedBashPrefixes(policy, commands?.ok ? commands.data : null);
      bashPrefixes.set(record.id, prefixes);
      return {
        permissionMode: policy.edits === 'accept' ? 'acceptEdits' : 'default',
        allowedTools: bashAllowRules(prefixes),
        canUseTool: canUseTool(record.id),
      };
    },

    canUseTool,

    resolve(ticketId, requestId, decision) {
      const entry = waiting.get(ticketId)?.find((candidate) => candidate.request.requestId === requestId);
      if (!entry) return false;
      const who = userName();
      const what = `${entry.request.tool}${entry.request.detail ? ` · ${entry.request.detail}` : ''}`;
      if (decision === 'deny') {
        options.transcripts?.appendSystem(ticketId, `${who} denied ${what}`);
        finish(ticketId, entry, 'denied', { behavior: 'deny', message: PERMISSION_DENIED_MESSAGE });
        return true;
      }
      if (decision === 'allow-ticket') {
        const rules = allowedForTicket.get(ticketId) ?? new Set<string>();
        rules.add(entry.rule);
        allowedForTicket.set(ticketId, rules);
      }
      options.transcripts?.appendSystem(ticketId, `${who} allowed ${what} ${decision === 'allow-ticket' ? 'for this ticket' : 'once'}`);
      finish(ticketId, entry, 'allowed', {
        behavior: 'allow',
        ...(decision === 'allow-ticket' && entry.suggestions.length > 0 ? { updatedPermissions: entry.suggestions } : {}),
      });
      // Another request for the same rule now goes through too.
      if (decision === 'allow-ticket') {
        for (const other of [...(waiting.get(ticketId) ?? [])]) {
          if (other.rule === entry.rule) finish(ticketId, other, 'allowed', { behavior: 'allow' });
        }
      }
      return true;
    },

    pending: oldest,

    cancelAll(ticketId) {
      for (const entry of [...(waiting.get(ticketId) ?? [])]) {
        finish(ticketId, entry, 'cancelled', { behavior: 'deny', message: PERMISSION_CANCELLED_MESSAGE });
      }
    },
  };
}
