import { describe, expect, it } from 'vitest';
import { WorkItemSchema, type WorkItem } from './ado.schemas';

const item: WorkItem = {
  id: 71273,
  project: 'OnSite Companion',
  type: 'User Story',
  title: 'Cutover frmJobControl to Blazor',
  state: 'Active',
  stateCategory: 'in-progress',
  assignedTo: { displayName: 'Kyle Richards', uniqueName: 'kyle.richards@example.com' },
  iterationPath: 'OnSite Companion\\Sprint 42',
  description: '<div>Cut frmJobControl over to Blazor.</div>',
  acceptanceCriteria: null,
  webUrl: 'https://dev.azure.com/contoso/OnSite%20Companion/_workitems/edit/71273',
};

describe('WorkItemSchema', () => {
  it('accepts a work item as artboards 2 and 3 show it', () => {
    expect(WorkItemSchema.parse(item)).toEqual(item);
    expect(WorkItemSchema.parse({ ...item, assignedTo: null, description: null })).toMatchObject({ assignedTo: null });
  });

  it.each([
    ['a javascript: web URL', { webUrl: 'javascript:alert(1)' }],
    ['a file: web URL', { webUrl: 'file:///C:/Windows/system32/calc.exe' }],
    ['id 0', { id: 0 }],
    ['an id beyond 32 bits', { id: 2 ** 31 }],
    ['a state category ADO does not have', { stateCategory: 'done' }],
    ['an empty project', { project: '' }],
  ])('refuses %s', (_case, change) => {
    expect(WorkItemSchema.safeParse({ ...item, ...change }).success).toBe(false);
  });
});
