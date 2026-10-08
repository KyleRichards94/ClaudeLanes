import { describe, expect, it } from 'vitest';
import { fakeTicketRecord } from '@/shared/testing';
import { createTicketFeed } from './feed';
import { createAgentTicketStore } from './store';

function setup() {
  const store = createAgentTicketStore();
  store.load([fakeTicketRecord({ id: '71273' }), fakeTicketRecord({ id: '71310', stage: 'qa' }), fakeTicketRecord({ id: '71301', stage: 'code-review' })]);
  const feed = createTicketFeed(store);
  const lines = () => feed.getState().events.map((event) => `${event.ticketLabel} ${event.text}${event.needsYou ? ' (needs you)' : ''}`);
  return { store, feed, lines };
}

describe('ticket feed', () => {
  it('keeps the latest three events across tickets, newest first', () => {
    const { store, lines } = setup();
    store.setActivity('71301', { text: 'review found 2 issues' }, 1_000);
    store.setNeedsYou('71310', { kind: 'qa-gap', gaps: 1, since: 1_100 });
    store.setActivity('71273', { text: 'razor-writer committed 3 files' }, 1_200);
    store.setStage('71273', 'code-review', 1_300);

    expect(lines()).toEqual(['#71273 moved to Code review', '#71273 razor-writer committed 3 files', '#71310 Needs you · 1 gap (needs you)']);
  });

  it('reports gates, builds, pull requests and merges', () => {
    const { store, lines } = setup();
    store.openGate('71301', 'code-review', 1_000);
    store.setLastBuild('71273', { outcome: 'failed', startedAt: 1_000, finishedAt: 1_100, errors: 3, warnings: 0 });
    store.setStage('71310', 'done', 1_200);
    expect(lines()).toEqual(['#71310 merged into main', '#71273 build failed · 3 errors', '#71301 Needs you · approve fixes (needs you)']);

    store.setPullRequest('71273', { id: 10612, status: 'active', checks: null });
    expect(lines()[0]).toBe('#71273 PR !10612');
  });

  it('adds nothing for output alone, unchanged values or tickets that just loaded, and stops when disposed', () => {
    const { store, feed, lines } = setup();
    store.recordOutput([{ ticketId: '71273', at: 5 }]);
    store.setActivity('71273', { text: 'Editing' }, 10);
    store.setActivity('71273', { text: 'Editing', progress: 0.5 }, 11);
    store.upsert(fakeTicketRecord({ id: '71999', stage: 'planning' }));
    expect(lines()).toEqual(['#71273 Editing']);

    feed.dispose();
    store.setActivity('71273', { text: 'Testing' }, 12);
    expect(lines()).toEqual(['#71273 Editing']);
  });
});

describe('ticket feed: design specs (AL-200)', () => {
  it('reports a shipped spec and its acknowledgement, once each', () => {
    const { store, lines } = setup();
    store.setDesignSpec('71273', 2, 'shipped', 1_000);
    store.setDesignSpec('71273', 2, 'delivered', 1_001);
    store.setDesignSpec('71273', 2, 'fetched', 1_002);
    store.setDesignSpec('71273', 2, 'used', 1_100);
    expect(lines()).toEqual(['#71273 Design v2 used by the agent', '#71273 Design v2 shipped to the agent']);
  });
});
