import { join } from 'node:path';
import { defaultSettings, defaultStageGates, ok, withAgentLanesPrefix, type Settings, type WorkItemComment } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { createStageService } from '../agent/stages/stage-service';
import { SESSION_TEST_BASE, memoryTickets, recordingEmit } from '../agent/testing/sessions';
import { adoConnectionIdFor, createStageComments, stageCommentText } from './stage-comments';
import type { WorkItemTarget } from './write-back';

const REPO = join(SESSION_TEST_BASE, 'onsite-companion');

function settingsWith(adoWriteBack?: boolean): { get: () => Settings } {
  return {
    get: () => ({
      ...defaultSettings(),
      repos: [
        {
          path: REPO,
          name: 'onsite-companion',
          baseBranch: 'main',
          worktreeRoot: join(SESSION_TEST_BASE, '.agent-lanes'),
          buildCommand: null,
          runCommand: null,
          maxConcurrentAgents: 3,
          ...(adoWriteBack === undefined ? {} : { adoWriteBack }),
        },
      ],
    }),
  };
}

/** The work item's discussion in memory, as the write-back would post and read it. */
function fakeWriteBack(existing: string[] = []) {
  const posted: Array<{ target: WorkItemTarget; text: string }> = [];
  let id = 0;
  const comment = (text: string): WorkItemComment => ({
    id: (id += 1),
    workItemId: 71273,
    text: `<div>${withAgentLanesPrefix(text).replace(/·/g, '&middot;')}</div>`,
    format: 'html',
    author: 'Kyle Richards',
    createdAt: '2026-10-08T00:00:00.000Z',
    updatedAt: null,
    fromAgentLanes: true,
  });
  const discussion = existing.map(comment);
  return {
    posted,
    writeBack: {
      comment: async (target: WorkItemTarget, text: string) => {
        posted.push({ target, text });
        const added = comment(text);
        discussion.push(added);
        return ok(added);
      },
      comments: async () => ok([...discussion]),
    },
  };
}

async function setup(options: { adoWriteBack?: boolean; existing?: string[]; ado?: null } = {}) {
  const tickets = await memoryTickets({ id: '71273', stage: 'planning', gates: defaultStageGates(), ...(options.ado === null ? { ado: null } : {}) });
  const fake = fakeWriteBack(options.existing);
  const waits: number[] = [];
  let clock = 1_000;
  const comments = createStageComments({
    tickets,
    settings: settingsWith(options.adoWriteBack),
    writeBack: fake.writeBack,
    orgFor: async (orgUrl) => (orgUrl === 'https://dev.azure.com/contoso' ? 'ado:contoso' : undefined),
    minIntervalMs: 5_000,
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
  });
  const stages = createStageService({ tickets, emit: recordingEmit().emit, userName: () => 'Kyle', onStageChanged: (change) => comments.stageChanged(change) });
  return { tickets, stages, comments, posted: fake.posted, waits };
}

describe('ADO write-back on stage change (AL-115)', () => {
  it('posts one comment per stage change, naming who approved a gate', async () => {
    const { stages, comments, posted } = await setup();

    const moving = stages.setStage('71273', 'implementing', 'Plan ready');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stages.resolveGate('71273', { approve: true })).toBe(true);
    await moving;
    await stages.setStage('71273', 'code-review', 'Grid and filters done');
    await comments.idle();

    expect(posted.map((entry) => entry.text)).toEqual(['Implementing — plan approved by Kyle', 'Code review — Grid and filters done']);
    expect(posted[0]?.target).toEqual({ org: 'ado:contoso', project: 'OnSite Companion', workItemId: 71273 });
  });

  it('is never duplicated: the same stage entry twice, a no-op move, or a resumed session repeating its stage', async () => {
    const { stages, comments, posted } = await setup({ existing: ['Code review — Grid and filters done'] });
    const change = { ticketId: '71273', from: 'implementing', to: 'code-review', at: 5, summary: 'Grid and filters done' } as const;

    // The discussion already ends with this comment (posted before the app restarted and the session resumed).
    comments.stageChanged(change);
    comments.stageChanged(change);
    // A move to the stage the ticket is already in changes nothing and posts nothing.
    await stages.setStage('71273', 'planning', 'still planning');
    await comments.idle();
    expect(posted).toEqual([]);

    comments.stageChanged({ ...change, to: 'qa', from: 'code-review', at: 6, summary: null });
    comments.stageChanged({ ...change, to: 'qa', from: 'code-review', at: 6, summary: null });
    await comments.idle();
    expect(posted.map((entry) => entry.text)).toEqual(['QA']);
  });

  it('rate-limits comments to one work item', async () => {
    const { comments, posted, waits } = await setup();
    comments.stageChanged({ ticketId: '71273', from: 'planning', to: 'implementing', at: 1, summary: 'a' });
    comments.stageChanged({ ticketId: '71273', from: 'implementing', to: 'code-review', at: 2, summary: 'b' });
    comments.stageChanged({ ticketId: '71273', from: 'code-review', to: 'qa', at: 3, summary: 'c' });
    await comments.idle();
    expect(posted).toHaveLength(3);
    expect(waits).toEqual([5_000, 5_000]);
  });

  it("posts nothing when the repo's switch is off, or for a ticket without a work item", async () => {
    const off = await setup({ adoWriteBack: false });
    off.comments.stageChanged({ ticketId: '71273', from: 'planning', to: 'implementing', at: 1, summary: null });
    await off.comments.idle();
    expect(off.posted).toEqual([]);

    const noTicket = await setup({ ado: null });
    noTicket.comments.stageChanged({ ticketId: '71273', from: 'planning', to: 'implementing', at: 1, summary: null });
    await noTicket.comments.idle();
    expect(noTicket.posted).toEqual([]);
  });

  it('writes short comment text', () => {
    expect(stageCommentText({ to: 'create-pr', summary: null, gate: { stage: 'create-pr', by: null } })).toBe('Create PR — PR approved (gate switched off)');
    expect(stageCommentText({ to: 'qa', summary: `  ${'x'.repeat(300)} ` })).toHaveLength('QA — '.length + 200);
  });

  it('finds the organisation connection for a work item URL', async () => {
    const connections = { list: async () => [{ kind: 'ado', id: 'ado:contoso', orgUrl: 'https://dev.azure.com/Contoso/' }] } as never;
    expect(await adoConnectionIdFor(connections, 'https://dev.azure.com/contoso')).toBe('ado:contoso');
    expect(await adoConnectionIdFor(connections, 'https://dev.azure.com/other')).toBeUndefined();
  });
});
