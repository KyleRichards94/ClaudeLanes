import { AGENT_LANES_COMMENT_PREFIX, WORK_ITEM_COMMENT_MAX_LENGTH, WorkItemCommentSchema, WorkItemStateChangeSchema } from '@agent-lanes/contracts';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { isAdoErrorDetails } from './errors';
import { createTestClient, FAKE_AUTHORIZATION, FAKE_PAT, ORG_URL, useMswServer } from './testing/msw-server';
import { addWorkItemComment, COMMENTS_API_VERSION, listWorkItemComments, setWorkItemState, toCommentHtml } from './write-back';

const server = useMswServer();

const PROJECT = 'Onsite Companion';
const ITEM = { project: PROJECT, workItemId: 71273 };
const COMMENTS_URL = `${ORG_URL}/Onsite%20Companion/_apis/wit/workItems/71273/comments`;
const WORK_ITEM_URL = `${ORG_URL}/Onsite%20Companion/_apis/wit/workitems/71273`;

interface StoredComment {
  id: number;
  workItemId: number;
  version: number;
  text: string;
  format?: string;
  createdBy?: { displayName: string; uniqueName: string };
  createdDate: string;
  modifiedDate: string;
  isDeleted?: boolean;
}

interface SeenRequest {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
}

/**
 * A small stand-in for one ADO work item: its discussion (Comments API, paged two at a time with a
 * continuation token) and its state (GET with `fields`, PATCH with JSON Patch and a revision test).
 */
function fakeWorkItem(initial: { state?: string; rev?: number; comments?: StoredComment[] } = {}) {
  const item = { state: initial.state ?? 'New', rev: initial.rev ?? 4, comments: [...(initial.comments ?? [])] };
  const seen: SeenRequest[] = [];
  let nextId = item.comments.length + 1;

  const record = async (request: Request) => {
    const text = await request.clone().text();
    seen.push({ method: request.method, url: new URL(request.url), headers: request.headers, body: text ? JSON.parse(text) : undefined });
  };

  server.use(
    http.post(COMMENTS_URL, async ({ request }) => {
      await record(request);
      const { text } = (await request.json()) as { text: string };
      const now = '2026-10-07T03:04:05.1234567Z';
      const comment: StoredComment = {
        id: nextId++,
        workItemId: 71273,
        version: 1,
        text,
        format: new URL(request.url).searchParams.get('format') === 'markdown' ? 'markdown' : 'html',
        createdBy: { displayName: 'Kyle Richards', uniqueName: 'kyle@example.com' },
        createdDate: now,
        modifiedDate: now,
      };
      item.comments.push(comment);
      return HttpResponse.json(comment);
    }),

    http.get(COMMENTS_URL, async ({ request }) => {
      await record(request);
      const url = new URL(request.url);
      const start = Number(url.searchParams.get('continuationToken') ?? '0');
      const page = item.comments.slice(start, start + 2);
      const next = start + 2 < item.comments.length ? String(start + 2) : undefined;
      return HttpResponse.json({ totalCount: item.comments.length, count: page.length, comments: page, ...(next ? { continuationToken: next } : {}) });
    }),

    http.get(WORK_ITEM_URL, async ({ request }) => {
      await record(request);
      return HttpResponse.json({ id: 71273, rev: item.rev, fields: { 'System.State': item.state }, url: WORK_ITEM_URL });
    }),

    http.patch(WORK_ITEM_URL, async ({ request }) => {
      await record(request);
      const ops = (await request.json()) as Array<{ op: string; path: string; value: unknown }>;
      const test = ops.find((op) => op.op === 'test' && op.path === '/rev');
      if (test && test.value !== item.rev) {
        return HttpResponse.json({ message: 'TF26071: This work item has been changed by someone else since you opened it.' }, { status: 412 });
      }
      for (const op of ops) {
        if (op.path === '/fields/System.State') item.state = String(op.value);
        if (op.path === '/fields/System.History') {
          item.comments.push({
            id: nextId++,
            workItemId: 71273,
            version: 1,
            text: String(op.value),
            createdDate: '2026-10-07T04:00:00Z',
            modifiedDate: '2026-10-07T04:00:00Z',
          });
        }
      }
      item.rev += 1;
      return HttpResponse.json({
        id: 71273,
        rev: item.rev,
        fields: { 'System.State': item.state, 'System.Title': 'frmJobControl cutover', 'System.Rev': item.rev },
      });
    }),
  );

  return { item, seen };
}

describe('addWorkItemComment', () => {
  it('posts a comment that is visible in ADO with the "Agent Lanes ·" prefix', async () => {
    const { item } = fakeWorkItem();
    const { client } = createTestClient();

    const posted = await addWorkItemComment(client, ITEM, 'Implementing — plan approved by Kyle');
    expect(posted.ok).toBe(true);

    // Read back the way the ADO web UI does: the work item's discussion.
    expect(item.comments.map((comment) => comment.text)).toEqual(['Agent Lanes · Implementing — plan approved by Kyle']);
    const listed = await listWorkItemComments(client, ITEM);
    expect(listed.ok && listed.data).toEqual([
      {
        id: 1,
        workItemId: 71273,
        text: 'Agent Lanes · Implementing — plan approved by Kyle',
        format: 'html',
        author: 'Kyle Richards',
        createdAt: '2026-10-07T03:04:05.123Z',
        updatedAt: null,
        fromAgentLanes: true,
      },
    ]);
    expect(posted.ok && posted.data).toEqual(listed.ok && listed.data[0]);
  });

  it('calls the Comments API preview with Basic auth, HTML format and a JSON body', async () => {
    const { seen } = fakeWorkItem();
    const { client } = createTestClient();

    await addWorkItemComment(client, ITEM, 'Planning');

    expect(seen).toHaveLength(1);
    const [request] = seen;
    expect(request?.method).toBe('POST');
    expect(request?.url.pathname).toBe('/contoso/Onsite%20Companion/_apis/wit/workItems/71273/comments');
    expect(request?.url.searchParams.get('api-version')).toBe(COMMENTS_API_VERSION);
    expect(request?.url.searchParams.get('format')).toBe('html');
    expect(request?.headers.get('authorization')).toBe(FAKE_AUTHORIZATION);
    expect(request?.headers.get('content-type')).toBe('application/json');
    expect(request?.body).toEqual({ text: 'Agent Lanes · Planning' });
  });

  it('adds the prefix once, even when the text already has it', async () => {
    const { item } = fakeWorkItem();
    const { client } = createTestClient();

    await addWorkItemComment(client, ITEM, `${AGENT_LANES_COMMENT_PREFIX}Code review — 2 findings`);
    expect(item.comments[0]?.text).toBe('Agent Lanes · Code review — 2 findings');
  });

  it('sends plain text as escaped HTML, keeping line breaks and trimming the ends', async () => {
    const { item } = fakeWorkItem();
    const { client } = createTestClient();

    const posted = await addWorkItemComment(client, ITEM, '  QA failed on <frmJobControl> & "Save"\nsee build #12\r\nretrying  ');

    expect(item.comments[0]?.text).toBe('Agent Lanes · QA failed on &lt;frmJobControl&gt; &amp; &quot;Save&quot;<br>see build #12<br>retrying');
    expect(posted.ok && posted.data.fromAgentLanes).toBe(true);
  });

  it.each<[string, { project: string; workItemId: number }, string]>([
    ['empty text', ITEM, '   '],
    ['text over the limit', ITEM, 'x'.repeat(WORK_ITEM_COMMENT_MAX_LENGTH + 1)],
    ['no project', { project: ' ', workItemId: 71273 }, 'Planning'],
    ['a zero work item id', { project: PROJECT, workItemId: 0 }, 'Planning'],
    ['a fractional work item id', { project: PROJECT, workItemId: 1.5 }, 'Planning'],
  ])('refuses %s without calling ADO', async (_case, ref, text) => {
    const { seen } = fakeWorkItem();
    const { client } = createTestClient();

    const result = await addWorkItemComment(client, ref, text);
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(seen).toHaveLength(0);
  });

  it.each([
    [401, 'ADO_UNAUTHORIZED'],
    [403, 'ADO_SCOPE_MISSING'],
    [404, 'INTERNAL'],
  ] as const)('maps a %i from the Comments API to %s without leaking the PAT', async (status, code) => {
    server.use(http.post(COMMENTS_URL, () => HttpResponse.json({ message: `TF401232: Work item 71273 does not exist (${FAKE_PAT})` }, { status })));
    const { client } = createTestClient();

    const result = await addWorkItemComment(client, ITEM, 'Planning');
    expect(result).toMatchObject({ ok: false, code });
    expect(!result.ok && isAdoErrorDetails(result.details) && result.details.status).toBe(status);
    expect(JSON.stringify(result)).not.toContain(FAKE_PAT);
  });
});

describe('listWorkItemComments', () => {
  const stored = (id: number, text: string, extra: Partial<StoredComment> = {}): StoredComment => ({
    id,
    workItemId: 71273,
    version: 1,
    text,
    createdBy: { displayName: 'Dana Smith', uniqueName: 'dana@example.com' },
    createdDate: `2026-10-0${id}T09:00:00Z`,
    modifiedDate: `2026-10-0${id}T09:00:00Z`,
    ...extra,
  });

  it('follows continuation tokens, oldest first, and leaves deleted comments out', async () => {
    const { seen } = fakeWorkItem({
      comments: [
        stored(1, '<div>Can we keep the old grid?</div>'),
        stored(2, 'Agent Lanes · Planning'),
        stored(3, 'removed', { isDeleted: true }),
        stored(4, '<div>Agent Lanes &middot; Implementing</div>', { modifiedDate: '2026-10-05T10:30:00.5Z' }),
        stored(5, 'Looks good to me', { format: 'markdown', createdBy: undefined }),
      ],
    });
    const { client } = createTestClient();

    const result = await listWorkItemComments(client, ITEM);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.map((comment) => [comment.id, comment.fromAgentLanes])).toEqual([
      [1, false],
      [2, true],
      [4, true],
      [5, false],
    ]);
    expect(result.data[2]).toMatchObject({ createdAt: '2026-10-04T09:00:00.000Z', updatedAt: '2026-10-05T10:30:00.500Z' });
    expect(result.data[3]).toMatchObject({ format: 'markdown', author: null });
    for (const comment of result.data) expect(WorkItemCommentSchema.safeParse(comment).success).toBe(true);

    expect(seen.map((request) => request.url.searchParams.get('continuationToken'))).toEqual([null, '2', '4']);
    for (const request of seen) {
      expect(request.url.searchParams.get('api-version')).toBe(COMMENTS_API_VERSION);
      expect(request.url.searchParams.get('order')).toBe('asc');
      expect(request.url.searchParams.get('$top')).toBe('200');
    }
  });

  it('fails on a comment whose date cannot be read rather than inventing one', async () => {
    fakeWorkItem({ comments: [stored(1, 'hello', { createdDate: 'yesterday' })] });
    const { client } = createTestClient();

    expect(await listWorkItemComments(client, ITEM)).toMatchObject({ ok: false, code: 'VALIDATION' });
  });
});

describe('setWorkItemState', () => {
  it('reads the state, then sets it with a JSON Patch guarded by the revision', async () => {
    const { item, seen } = fakeWorkItem({ state: 'New', rev: 4 });
    const { client } = createTestClient();

    const result = await setWorkItemState(client, ITEM, 'Active');

    expect(result).toEqual({ ok: true, data: { outcome: 'changed', workItemId: 71273, state: 'Active', previousState: 'New', rev: 5 } });
    expect(WorkItemStateChangeSchema.safeParse(result.ok && result.data).success).toBe(true);
    expect(item.state).toBe('Active');

    expect(seen.map((request) => request.method)).toEqual(['GET', 'PATCH']);
    const [read, write] = seen;
    expect(read?.url.searchParams.get('fields')).toBe('System.State');
    expect(read?.url.searchParams.get('api-version')).toBe('7.1');
    expect(write?.url.searchParams.get('api-version')).toBe('7.1');
    expect(write?.headers.get('content-type')).toBe('application/json-patch+json');
    expect(write?.headers.get('authorization')).toBe(FAKE_AUTHORIZATION);
    expect(write?.body).toEqual([
      { op: 'test', path: '/rev', value: 4 },
      { op: 'add', path: '/fields/System.State', value: 'Active' },
    ]);
  });

  it('writes nothing when the work item is already in that state, whatever the case', async () => {
    const { seen } = fakeWorkItem({ state: 'Active', rev: 9 });
    const { client } = createTestClient();

    const result = await setWorkItemState(client, ITEM, ' active ');

    expect(result).toEqual({ ok: true, data: { outcome: 'unchanged', workItemId: 71273, state: 'Active', rev: 9 } });
    expect(seen.map((request) => request.method)).toEqual(['GET']);
  });

  it('adds a prefixed, escaped reason to the discussion in the same revision', async () => {
    const { item, seen } = fakeWorkItem({ state: 'Active' });
    const { client } = createTestClient();

    const result = await setWorkItemState(client, ITEM, 'Resolved', { reason: 'PR !10612 merged <main>' });

    expect(result.ok && result.data).toMatchObject({ outcome: 'changed', state: 'Resolved' });
    expect(seen[1]?.body).toContainEqual({ op: 'add', path: '/fields/System.History', value: 'Agent Lanes · PR !10612 merged &lt;main&gt;' });
    const listed = await listWorkItemComments(client, ITEM);
    expect(listed.ok && listed.data.map((comment) => comment.fromAgentLanes)).toEqual([true]);
    expect(item.rev).toBe(5);
  });

  it('reports a state the work item type does not allow as VALIDATION with ADO’s reason', async () => {
    fakeWorkItem({ state: 'New' });
    server.use(
      http.patch(WORK_ITEM_URL, () =>
        HttpResponse.json(
          { message: "TF401320: Rule Error for field State. Error code: Required, InvalidListValue. The field 'State' contains the value 'Shipped' that is not in the list of supported values" },
          { status: 400 },
        ),
      ),
    );
    const { client } = createTestClient();

    const result = await setWorkItemState(client, ITEM, 'Shipped');
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(!result.ok && result.message).toContain('TF401320');
  });

  it('never overwrites a change someone made after the state was read', async () => {
    const { item } = fakeWorkItem({ state: 'New', rev: 4 });
    server.use(
      http.get(WORK_ITEM_URL, () => {
        const answer = HttpResponse.json({ id: 71273, rev: item.rev, fields: { 'System.State': item.state } });
        // Someone moves the item in the ADO web UI between our read and our write.
        item.state = 'Removed';
        item.rev += 1;
        return answer;
      }),
    );
    const { client } = createTestClient();

    const result = await setWorkItemState(client, ITEM, 'Active');
    expect(result).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(!result.ok && result.message).toContain('changed in Azure DevOps while its state was being set');
    expect(!result.ok && isAdoErrorDetails(result.details) && result.details.status).toBe(412);
    expect(item.state).toBe('Removed');
  });

  it.each<[string, string, { reason?: string }]>([
    ['an empty state', '  ', {}],
    ['a state with a control character', 'Act\u0000ive', {}],
    ['a state name over 128 characters', 'S'.repeat(129), {}],
    ['an empty reason', 'Active', { reason: ' ' }],
  ])('refuses %s without calling ADO', async (_case, state, options) => {
    const { seen } = fakeWorkItem();
    const { client } = createTestClient();

    expect(await setWorkItemState(client, ITEM, state, options)).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(seen).toHaveLength(0);
  });

  it('stops at a failed read and writes nothing', async () => {
    const { seen } = fakeWorkItem();
    server.use(http.get(WORK_ITEM_URL, () => new HttpResponse(null, { status: 401 })));
    const { client } = createTestClient();

    expect(await setWorkItemState(client, ITEM, 'Active')).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED' });
    expect(seen.filter((request) => request.method === 'PATCH')).toHaveLength(0);
  });
});

describe('toCommentHtml', () => {
  it('escapes markup and quotes and turns every kind of line break into <br>', () => {
    expect(toCommentHtml(`a<b>&'c'\r\nd\re\nf`)).toBe('a&lt;b&gt;&amp;&#39;c&#39;<br>d<br>e<br>f');
  });
});
