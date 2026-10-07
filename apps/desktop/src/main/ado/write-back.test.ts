import { createAdoClient, type AdoClient, type FetchLike } from '@agent-lanes/ado-client';
import { WorkItemStateWriteBackSchema, err, ok, type Result } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createSettingsService } from '../settings/service';
import { createMemorySettingsFile } from '../settings/settings-file';
import { createWorkItemWriteBack, type WorkItemTarget } from './write-back';

/** Shaped like a PAT; valid nowhere. */
const FAKE_PAT = 'fakepatq8w3e5r7t9y1u2i4o6p8a0s2d4f6g8h0j2k4l6z8x0c2v';
const ORG_URL = 'https://dev.azure.com/contoso';
const TARGET: WorkItemTarget = { org: 'ado:contoso', project: 'Onsite Companion', workItemId: 71273 };

interface Seen {
  method: string;
  url: URL;
  body: unknown;
}

/** A fake `fetch` standing in for Azure DevOps: one work item with a state and a discussion. */
function fakeAdo(state = 'New') {
  const item = { state, rev: 7, comments: [] as Array<{ id: number; text: string }> };
  const seen: Seen[] = [];

  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    seen.push({ method, url, body });

    const path = decodeURIComponent(url.pathname);
    if (path === '/contoso/Onsite Companion/_apis/wit/workItems/71273/comments' && method === 'POST') {
      const comment = {
        id: item.comments.length + 1,
        workItemId: 71273,
        version: 1,
        text: (body as { text: string }).text,
        createdBy: { displayName: 'Kyle Richards' },
        createdDate: '2026-10-07T03:04:05Z',
        modifiedDate: '2026-10-07T03:04:05Z',
      };
      item.comments.push(comment);
      return Response.json(comment);
    }
    if (path === '/contoso/Onsite Companion/_apis/wit/workItems/71273/comments' && method === 'GET') {
      return Response.json({
        comments: item.comments.map((comment) => ({ ...comment, workItemId: 71273, createdDate: '2026-10-07T03:04:05Z' })),
      });
    }
    if (path === '/contoso/Onsite Companion/_apis/wit/workitems/71273' && method === 'GET') {
      return Response.json({ id: 71273, rev: item.rev, fields: { 'System.State': item.state } });
    }
    if (path === '/contoso/Onsite Companion/_apis/wit/workitems/71273' && method === 'PATCH') {
      for (const op of body as Array<{ path: string; value: unknown }>) if (op.path === '/fields/System.State') item.state = String(op.value);
      item.rev += 1;
      return Response.json({ id: 71273, rev: item.rev, fields: { 'System.State': item.state } });
    }
    return Response.json({ message: `No fake for ${method} ${path}` }, { status: 404 });
  };

  const created = createAdoClient({ orgUrl: ORG_URL, pat: FAKE_PAT, fetch });
  if (!created.ok) throw new Error(created.message);
  return { item, seen, client: created.data };
}

function setup(options: { state?: string; stored?: unknown } = {}) {
  const ado = fakeAdo(options.state);
  const settings = createSettingsService({ file: createMemorySettingsFile(options.stored), warn: vi.fn() });
  const clientFor = vi.fn((org: string): Result<AdoClient> => (org === 'ado:contoso' ? ok(ado.client) : err('ADO_UNAUTHORIZED', `${org} is not connected`)));
  return { ...ado, settings, clientFor, writeBack: createWorkItemWriteBack({ clientFor, settings }) };
}

describe('work item write-back (main)', () => {
  it('posts a comment with the "Agent Lanes ·" prefix through the organisation’s client', async () => {
    const { writeBack, item, clientFor } = setup();

    const posted = await writeBack.comment(TARGET, 'Implementing — plan approved by Kyle');

    expect(posted.ok && posted.data).toMatchObject({ text: 'Agent Lanes · Implementing — plan approved by Kyle', fromAgentLanes: true });
    expect(item.comments.map((comment) => comment.text)).toEqual(['Agent Lanes · Implementing — plan approved by Kyle']);
    expect(clientFor).toHaveBeenCalledWith('ado:contoso');

    const listed = await writeBack.comments(TARGET);
    expect(listed.ok && listed.data.map((comment) => comment.fromAgentLanes)).toEqual([true]);
  });

  describe('state transitions', () => {
    it('are off by default: nothing is sent to ADO and the result says disabled', async () => {
      const { writeBack, seen, item, clientFor } = setup();

      const result = await writeBack.setState(TARGET, 'Active', { reason: 'Implementing' });

      expect(result).toEqual({ ok: true, data: { outcome: 'disabled', workItemId: 71273 } });
      expect(WorkItemStateWriteBackSchema.safeParse(result.ok && result.data).success).toBe(true);
      expect(seen).toHaveLength(0);
      expect(clientFor).not.toHaveBeenCalled();
      expect(item.state).toBe('New');
    });

    it('move the work item once the setting is on', async () => {
      const { writeBack, settings, item, seen } = setup();
      settings.update({ adoStateTransitions: true });

      const result = await writeBack.setState(TARGET, 'Active');

      expect(result).toEqual({ ok: true, data: { outcome: 'changed', workItemId: 71273, state: 'Active', previousState: 'New', rev: 8 } });
      expect(item.state).toBe('Active');
      expect(seen.map((request) => request.method)).toEqual(['GET', 'PATCH']);
    });

    it('follow the setting at every call, so turning it off stops the next change', async () => {
      const { writeBack, settings, item } = setup({ stored: { version: 2, adoStateTransitions: true } });

      expect((await writeBack.setState(TARGET, 'Active')).ok).toBe(true);
      settings.update({ adoStateTransitions: false });
      const result = await writeBack.setState(TARGET, 'Resolved');

      expect(result.ok && result.data.outcome).toBe('disabled');
      expect(item.state).toBe('Active');
    });

    it('report unchanged when the work item is already in that state', async () => {
      const { writeBack, settings, seen } = setup({ state: 'Active' });
      settings.update({ adoStateTransitions: true });

      const result = await writeBack.setState(TARGET, 'Active');

      expect(result.ok && result.data).toEqual({ outcome: 'unchanged', workItemId: 71273, state: 'Active', rev: 7 });
      expect(seen.map((request) => request.method)).toEqual(['GET']);
    });
  });

  it('returns the client error for an organisation that is not connected', async () => {
    const { writeBack, seen } = setup();

    const result = await writeBack.comment({ ...TARGET, org: 'ado:fabrikam' }, 'Planning');

    expect(result).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED' });
    expect(seen).toHaveLength(0);
  });

  it('turns a client lookup that throws into INTERNAL instead of throwing', async () => {
    const { settings } = setup();
    const writeBack = createWorkItemWriteBack({
      settings,
      clientFor: async () => {
        throw new Error('connections file unreadable');
      },
    });

    await expect(writeBack.comment(TARGET, 'Planning')).resolves.toMatchObject({ ok: false, code: 'INTERNAL' });
    settings.update({ adoStateTransitions: true });
    await expect(writeBack.setState(TARGET, 'Active')).resolves.toMatchObject({ ok: false, code: 'INTERNAL' });
  });

  it('keeps the PAT out of every result', async () => {
    const { writeBack, settings } = setup();
    settings.update({ adoStateTransitions: true });

    const results = await Promise.all([
      writeBack.comment(TARGET, 'Planning'),
      writeBack.comment({ ...TARGET, workItemId: 1 }, 'Planning'),
      writeBack.setState({ ...TARGET, workItemId: 1 }, 'Active'),
      writeBack.comments(TARGET),
    ]);
    expect(results[1]).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(JSON.stringify(results)).not.toContain(FAKE_PAT);
    expect(JSON.stringify(results)).not.toContain(btoa(`:${FAKE_PAT}`));
  });
});
