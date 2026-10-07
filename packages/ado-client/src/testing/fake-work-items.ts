import { http, HttpResponse } from 'msw';
import type { SetupServer } from 'msw/node';
import { ORG_URL } from './msw-server';

/**
 * Test-only fake of the Azure DevOps work item endpoints AL-062 uses: WIQL (with a small interpreter
 * for the flat queries the client writes), `workitemsbatch`, `workitems/{id}` and a type's states.
 * Not exported from the package; AL-065 owns the app-wide MSW fixtures and may build on this.
 */

export const FAKE_PROJECT = 'OnSite Companion';
export const SPRINT_42 = `${FAKE_PROJECT}\\Sprint 42`;
export const SPRINT_43 = `${FAKE_PROJECT}\\Sprint 43`;

export interface FakeWorkItem {
  id: number;
  project: string;
  type: string;
  title: string;
  state: string;
  iterationPath: string;
  /** ISO time; WIQL search orders by it. */
  changedDate: string;
  assignedTo?: { displayName: string; uniqueName: string } | string;
  description?: string;
  acceptanceCriteria?: string;
}

type FakeWorkItemInput = Omit<FakeWorkItem, 'project' | 'iterationPath' | 'changedDate'> & Partial<FakeWorkItem>;

function item(input: FakeWorkItemInput): FakeWorkItem {
  return { project: FAKE_PROJECT, iterationPath: SPRINT_42, changedDate: '2026-10-01T09:00:00Z', ...input };
}

/** The four items on artboard 2, in Sprint 42. */
export function artboardWorkItems(): FakeWorkItem[] {
  return [
    item({
      id: 71273,
      type: 'User Story',
      title: 'Cutover frmJobControl to Blazor',
      state: 'Active',
      assignedTo: { displayName: 'Kyle Richards', uniqueName: 'kyle.richards@example.com' },
      description: '<div>Cut frmJobControl over to Blazor. Keep the WinForms child modals invoked via IWinFormsInvoker.</div>',
      acceptanceCriteria: '<ul><li>Grid filters work as in WinForms.</li></ul>',
      changedDate: '2026-10-06T23:58:00Z',
    }),
    item({ id: 71330, type: 'Bug', title: 'Asset register paging slow above 5k rows', state: 'New' }),
    item({ id: 71335, type: 'User Story', title: 'Client portal: show defect photos inline', state: 'New' }),
    item({ id: 71341, type: 'Bug', title: 'Roster view ignores public holidays', state: 'New' }),
  ];
}

/**
 * Sprint 42 with `tasks` extra tasks (ids from 80001), plus items the sprint list must leave out:
 * an Epic and a Feature in Sprint 42, a story in Sprint 43, and a same-titled story in another project.
 */
export function sprint42Backlog(tasks: number): FakeWorkItem[] {
  const states = ['New', 'Active', 'Closed'];
  return [
    ...artboardWorkItems(),
    ...Array.from({ length: tasks }, (_, i) =>
      item({ id: 80_001 + i, type: 'Task', title: `Task ${i + 1}`, state: states[i % states.length]!, changedDate: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T08:00:00Z` }),
    ),
    item({ id: 70001, type: 'Epic', title: 'Blazor cutover', state: 'Active' }),
    item({ id: 70002, type: 'Feature', title: 'Job control in Blazor', state: 'Active' }),
    item({ id: 71400, type: 'User Story', title: 'Job costing tab', state: 'New', iterationPath: SPRINT_43 }),
    item({ id: 71500, type: 'User Story', title: 'Cutover frmJobControl to Blazor', state: 'New', project: 'Other Project', iterationPath: 'Other Project\\Sprint 42' }),
  ];
}

/** Agile process states with their categories, per type. Tests may edit it. */
export function agileStates(): Record<string, Array<{ name: string; category: string }>> {
  const full = [
    { name: 'New', category: 'Proposed' },
    { name: 'Active', category: 'InProgress' },
    { name: 'Resolved', category: 'Resolved' },
    { name: 'Closed', category: 'Completed' },
    { name: 'Removed', category: 'Removed' },
  ];
  return {
    'User Story': full,
    Bug: full.filter((state) => state.name !== 'Removed'),
    Task: full.filter((state) => state.name !== 'Resolved'),
    Epic: full,
    Feature: full,
  };
}

/** `IN GROUP` category → type names, as in the Agile process. */
const CATEGORY_TYPES: Record<string, string[]> = {
  'microsoft.requirementcategory': ['User Story'],
  'microsoft.bugcategory': ['Bug'],
  'microsoft.taskcategory': ['Task'],
  'microsoft.epiccategory': ['Epic'],
  'microsoft.featurecategory': ['Feature'],
};

const FIELDS: Record<string, { name: string; get: (item: FakeWorkItem) => unknown }> = Object.fromEntries(
  (
    [
      ['System.Id', (i) => i.id],
      ['System.Title', (i) => i.title],
      ['System.WorkItemType', (i) => i.type],
      ['System.State', (i) => i.state],
      ['System.AssignedTo', (i) => i.assignedTo],
      ['System.IterationPath', (i) => i.iterationPath],
      ['System.TeamProject', (i) => i.project],
      ['System.ChangedDate', (i) => i.changedDate],
      ['System.Description', (i) => i.description],
      ['Microsoft.VSTS.Common.AcceptanceCriteria', (i) => i.acceptanceCriteria],
    ] as Array<[string, (item: FakeWorkItem) => unknown]>
  ).map(([name, get]) => [name.toLowerCase(), { name, get }]),
);

export interface FakeAdo {
  items: FakeWorkItem[];
  states: Record<string, Array<{ name: string; category: string }>>;
  /** Ids WIQL still finds but reads leave out, as if deleted between the query and the read. */
  unreadable: Set<number>;
  /** Every WIQL query received. */
  wiql: Array<{ project: string; query: string; top: number | null }>;
  /** Ids asked for by each `workitemsbatch` call. */
  batches: number[][];
  /** `fields` of each `workitems/{id}` call. */
  gets: Array<{ id: number; fields: string[] }>;
  /** `project/type` of each states read. */
  stateReads: string[];
  /** Every request the fake answered. */
  requests: number;
}

/** Installs the fake's handlers on a test's MSW server and returns its state. */
export function installFakeWorkItems(server: Pick<SetupServer, 'use'>, items: FakeWorkItem[]): FakeAdo {
  const fake: FakeAdo = { items, states: agileStates(), unreadable: new Set(), wiql: [], batches: [], gets: [], stateReads: [], requests: 0 };
  const byId = (id: number) => (fake.unreadable.has(id) ? undefined : fake.items.find((candidate) => candidate.id === id));

  server.use(
    http.post(`${ORG_URL}/:project/_apis/wit/wiql`, async ({ request, params }) => {
      fake.requests += 1;
      const project = String(params['project']);
      const url = new URL(request.url);
      const { query } = (await request.json()) as { query: string };
      const topParam = url.searchParams.get('$top');
      const top = topParam === null ? null : Number(topParam);
      fake.wiql.push({ project, query, top });

      let parsed: ParsedWiql;
      try {
        parsed = parseWiql(query, project);
      } catch (error) {
        return HttpResponse.json({ message: (error as Error).message, typeKey: 'WorkItemTrackingQuerySyntaxException' }, { status: 400 });
      }
      const matches = fake.items.filter(parsed.where).sort(parsed.compare);
      return HttpResponse.json({
        queryType: 'flat',
        queryResultType: 'workItem',
        asOf: '2026-10-07T00:00:00Z',
        columns: [{ referenceName: 'System.Id', name: 'ID', url: `${ORG_URL}/_apis/wit/fields/System.Id` }],
        workItems: (top === null ? matches : matches.slice(0, top)).map((match) => ({ id: match.id, url: `${ORG_URL}/_apis/wit/workItems/${match.id}` })),
      });
    }),

    http.post(`${ORG_URL}/_apis/wit/workitemsbatch`, async ({ request }) => {
      fake.requests += 1;
      const body = (await request.json()) as { ids: number[]; fields: string[]; errorPolicy?: string };
      fake.batches.push(body.ids);
      if (body.ids.length > 200) {
        return HttpResponse.json({ message: 'VS403474: The number of work items requested exceeds the limit of 200.' }, { status: 400 });
      }
      const unknown = body.fields.find((field) => !FIELDS[field.toLowerCase()]);
      if (unknown) return HttpResponse.json({ message: `TF51535: Cannot find field ${unknown}.` }, { status: 400 });

      const value = body.ids.map((id) => byId(id) ?? null);
      if (body.errorPolicy?.toLowerCase() !== 'omit' && value.includes(null)) {
        return HttpResponse.json({ message: 'TF401232: Work item does not exist, or you do not have permissions to read it.' }, { status: 404 });
      }
      return HttpResponse.json({ count: value.length, value: value.map((found) => found && toAdo(found, body.fields)) });
    }),

    http.get(`${ORG_URL}/_apis/wit/workitems/:id`, ({ request, params }) => {
      fake.requests += 1;
      const id = Number(params['id']);
      const fields = (new URL(request.url).searchParams.get('fields') ?? '').split(',').filter(Boolean);
      fake.gets.push({ id, fields });
      const found = byId(id);
      if (!found) {
        return HttpResponse.json(
          { message: `TF401232: Work item ${id} does not exist, or you do not have permissions to read it.`, typeKey: 'WorkItemUnauthorizedAccessException' },
          { status: 404 },
        );
      }
      return HttpResponse.json(toAdo(found, fields.length > 0 ? fields : Object.values(FIELDS).map((field) => field.name)));
    }),

    http.get(`${ORG_URL}/:project/_apis/wit/workitemtypes/:type/states`, ({ params }) => {
      fake.requests += 1;
      const project = String(params['project']);
      const type = String(params['type']);
      fake.stateReads.push(`${project}/${type}`);
      const states = Object.entries(fake.states).find(([name]) => name.toLowerCase() === type.toLowerCase())?.[1];
      if (!states) return HttpResponse.json({ message: `VS402323: Work item type ${type} does not exist.` }, { status: 404 });
      return HttpResponse.json({ count: states.length, value: states.map((state) => ({ ...state, color: '007acc' })) });
    }),
  );
  return fake;
}

/** A work item as ADO returns it: only the requested fields that have a value. */
function toAdo(found: FakeWorkItem, fields: string[]) {
  const values = Object.fromEntries(
    fields.flatMap((name) => {
      const field = FIELDS[name.toLowerCase()];
      const value = field?.get(found);
      return field && value !== undefined && value !== '' ? [[field.name, value]] : [];
    }),
  );
  return { id: found.id, rev: 3, fields: values, url: `${ORG_URL}/_apis/wit/workItems/${found.id}` };
}

// ── A small WIQL interpreter ─────────────────────────────────────────────────────────────────────
// Enough of WIQL for flat work item queries: SELECT fields FROM WorkItems WHERE conditions joined by
// AND / OR with parentheses (=, <>, CONTAINS, IN (…), IN GROUP, UNDER; strings, numbers, @project),
// ORDER BY fields ASC/DESC. Anything else fails the way ADO does, with a 400.

interface ParsedWiql {
  where: (item: FakeWorkItem) => boolean;
  compare: (a: FakeWorkItem, b: FakeWorkItem) => number;
}

type Token =
  | { kind: 'field'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'macro'; value: string }
  | { kind: 'word'; value: string }
  | { kind: 'punct'; value: string };

function syntaxError(message: string): Error {
  return new Error(`TF51006: The query statement is not valid: ${message}`);
}

function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < query.length) {
    const ch = query[i]!;
    if (/\s/.test(ch)) {
      i += 1;
    } else if (ch === '[') {
      const end = query.indexOf(']', i);
      if (end < 0) throw syntaxError('unclosed [');
      tokens.push({ kind: 'field', value: query.slice(i + 1, end) });
      i = end + 1;
    } else if (ch === "'") {
      let value = '';
      i += 1;
      for (;;) {
        if (i >= query.length) throw syntaxError('unclosed string literal');
        if (query[i] === "'") {
          if (query[i + 1] !== "'") break;
          value += "'";
          i += 2;
        } else {
          value += query[i];
          i += 1;
        }
      }
      i += 1;
      tokens.push({ kind: 'string', value });
    } else if (query.startsWith('<>', i)) {
      tokens.push({ kind: 'punct', value: '<>' });
      i += 2;
    } else if ('(),='.includes(ch)) {
      tokens.push({ kind: 'punct', value: ch });
      i += 1;
    } else {
      const word = /^(?:@?[A-Za-z_][\w.]*|\d+)/.exec(query.slice(i))?.[0];
      if (!word) throw syntaxError(`unexpected "${ch}"`);
      if (/^\d+$/.test(word)) tokens.push({ kind: 'number', value: Number(word) });
      else if (word.startsWith('@')) tokens.push({ kind: 'macro', value: word.toLowerCase() });
      else tokens.push({ kind: 'word', value: word.toUpperCase() });
      i += word.length;
    }
  }
  return tokens;
}

function same(actual: unknown, expected: string | number): boolean {
  if (typeof actual === 'number' || typeof expected === 'number') return Number(actual) === Number(expected);
  return typeof actual === 'string' && actual.toLowerCase() === expected.toLowerCase();
}

function parseWiql(query: string, project: string): ParsedWiql {
  const tokens = tokenize(query);
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const next = (): Token => {
    const token = tokens[pos];
    if (!token) throw syntaxError('unexpected end of query');
    pos += 1;
    return token;
  };
  const isWord = (word: string) => peek()?.kind === 'word' && peek()?.value === word;
  const isPunct = (punct: string) => peek()?.kind === 'punct' && peek()?.value === punct;
  const expect = (kind: Token['kind'], value: string) => {
    const token = next();
    if (token.kind !== kind || token.value !== value) throw syntaxError(`expected ${value}`);
  };
  const field = () => {
    const token = next();
    if (token.kind !== 'field') throw syntaxError('expected a [field]');
    const known = FIELDS[token.value.toLowerCase()];
    if (!known) throw new Error(`TF51005: The query references a field that does not exist. The error is caused by «${token.value}».`);
    return known.get;
  };
  const value = (): string | number => {
    const token = next();
    if (token.kind === 'string' || token.kind === 'number') return token.value;
    if (token.kind === 'macro' && token.value === '@project') return project;
    throw syntaxError('expected a value');
  };

  const condition = (): ((item: FakeWorkItem) => boolean) => {
    const get = field();
    const op = next();
    if (op.kind === 'punct' && op.value === '=') {
      const expected = value();
      return (item) => same(get(item), expected);
    }
    if (op.kind === 'punct' && op.value === '<>') {
      const expected = value();
      return (item) => !same(get(item), expected);
    }
    if (op.kind === 'word' && op.value === 'CONTAINS') {
      const expected = String(value()).toLowerCase();
      return (item) => String(get(item) ?? '').toLowerCase().includes(expected);
    }
    if (op.kind === 'word' && op.value === 'UNDER') {
      const expected = String(value()).toLowerCase();
      return (item) => {
        const actual = String(get(item) ?? '').toLowerCase();
        return actual === expected || actual.startsWith(`${expected}\\`);
      };
    }
    if (op.kind === 'word' && op.value === 'IN') {
      if (isWord('GROUP')) {
        next();
        const types = CATEGORY_TYPES[String(value()).toLowerCase()];
        if (!types) throw syntaxError('unknown category');
        return (item) => types.some((type) => same(get(item), type));
      }
      expect('punct', '(');
      const values = [value()];
      while (isPunct(',')) {
        next();
        values.push(value());
      }
      expect('punct', ')');
      return (item) => values.some((expected) => same(get(item), expected));
    }
    throw syntaxError('unsupported operator');
  };
  const unary = (): ((item: FakeWorkItem) => boolean) => {
    if (!isPunct('(')) return condition();
    next();
    const inner = or();
    expect('punct', ')');
    return inner;
  };
  const and = () => {
    let left = unary();
    while (isWord('AND')) {
      next();
      const [l, r] = [left, unary()];
      left = (item) => l(item) && r(item);
    }
    return left;
  };
  const or = (): ((item: FakeWorkItem) => boolean) => {
    let left = and();
    while (isWord('OR')) {
      next();
      const [l, r] = [left, and()];
      left = (item) => l(item) || r(item);
    }
    return left;
  };

  expect('word', 'SELECT');
  field();
  while (isPunct(',')) {
    next();
    field();
  }
  expect('word', 'FROM');
  expect('word', 'WORKITEMS');
  expect('word', 'WHERE');
  const where = or();

  const order: Array<{ get: (item: FakeWorkItem) => unknown; desc: boolean }> = [];
  if (isWord('ORDER')) {
    next();
    expect('word', 'BY');
    do {
      if (order.length > 0) next();
      const get = field();
      let desc = false;
      if (isWord('ASC')) next();
      else if (isWord('DESC')) {
        next();
        desc = true;
      }
      order.push({ get, desc });
    } while (isPunct(','));
  }
  if (pos !== tokens.length) throw syntaxError('unexpected text after the query');

  const compare = (a: FakeWorkItem, b: FakeWorkItem): number => {
    for (const { get, desc } of order) {
      const [x, y] = [get(a), get(b)] as Array<string | number>;
      const result = x! < y! ? -1 : x! > y! ? 1 : 0;
      if (result !== 0) return desc ? -result : result;
    }
    return a.id - b.id;
  };
  return { where, compare };
}
