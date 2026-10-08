import type { BacklogItem, BacklogPage } from '@agent-lanes/contracts';

/** Test data: artboard 11's rows, as `ado:backlog` returns them (AL-233). */

export const OSC_TEAM = { id: 'osc', name: 'OSC Developers' };
export const KR = { id: 'kr', displayName: 'Kyle Richards', uniqueName: null, initials: 'KR' };
export const MD = { id: 'md', displayName: 'Mark Davies', uniqueName: null, initials: 'MD' };

export function backlogItem(id: number, fields: Partial<BacklogItem> = {}): BacklogItem {
  return {
    id,
    type: 'User Story',
    kind: 'story',
    title: `Item ${id}`,
    state: 'New',
    points: 3,
    priority: 2,
    tags: [],
    areaPath: 'OnSite Companion\\OSC',
    iterationPath: 'OnSite Companion',
    inSprint: false,
    assignee: null,
    parentId: null,
    webUrl: `https://dev.azure.com/CompanionSystems/OnSite%20Companion/_workitems/edit/${id}`,
    ...fields,
  };
}

const JOBS = { id: 70101, title: 'Job management' };
const PORTAL = { id: 70102, title: 'Client portal' };
const TIMESHEETS = { id: 70103, title: 'Timesheets' };

/** The seven rows on artboard 11, in backlog order, under their Features; 48 in the whole backlog. */
export function artboard11Page(overrides: Partial<BacklogPage> = {}): BacklogPage {
  return {
    team: OSC_TEAM,
    total: 48,
    page: { index: 0, size: 50, count: 1 },
    groups: [
      {
        feature: JOBS,
        items: [
          backlogItem(71360, { title: 'Bulk reassign jobs between technicians', tags: ['jobs'], points: 5, priority: 1, parentId: JOBS.id }),
          backlogItem(71362, { type: 'Bug', kind: 'bug', title: 'Job search ignores archived clients filter', tags: ['search'], points: 2, priority: 2, parentId: JOBS.id }),
          backlogItem(71371, { title: 'Recurring job templates for maintenance contracts', tags: ['jobs'], points: 8, priority: 2, parentId: JOBS.id }),
        ],
      },
      {
        feature: PORTAL,
        items: [
          backlogItem(71335, { title: 'Show defect photos inline on requests', tags: ['portal'], points: 5, priority: 1, parentId: PORTAL.id }),
          backlogItem(71377, {
            type: 'Bug',
            kind: 'bug',
            title: 'Portal session expires during file upload',
            tags: ['portal'],
            points: 3,
            priority: 1,
            parentId: PORTAL.id,
            areaPath: 'OnSite Companion\\OSC\\Portal',
          }),
          backlogItem(71380, { title: 'Client-side approval of quotes', tags: ['quotes', 'portal'], points: 8, priority: 3, parentId: PORTAL.id }),
        ],
      },
      {
        feature: TIMESHEETS,
        items: [backlogItem(71384, { type: 'Task', kind: 'task', title: 'Export timesheets to payroll CSV format v2', tags: ['payroll'], points: 3, priority: 2, parentId: TIMESHEETS.id })],
      },
    ],
    ...overrides,
  };
}
