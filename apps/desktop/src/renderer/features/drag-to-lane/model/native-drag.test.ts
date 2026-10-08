import { describe, expect, it } from 'vitest';
import { activeDrag } from './lane-state';
import { decodeNativeBacklogDrag, encodeNativeBacklogDrag, nativeBacklogPlaceholder } from './native-drag';
import type { LaneDragCard } from './types';

const row = (id: number, assignee: { id: string; displayName: string } | null = null): LaneDragCard => ({
  key: `backlog:${id}`,
  label: `#${id}`,
  title: `Backlog ${id}`,
  card: { kind: 'backlog-item', id, assignee, agentLane: null },
  me: { id: 'agent-lanes:me' },
  meName: 'Kyle Richards',
  source: { kind: 'backlog-item', id },
});

describe('native backlog drags (AL-239, TB§5 pop out)', () => {
  it('round-trips a selected group as backlog cards, with only ids and titles', () => {
    const rows = [row(71360, { id: 'agent-lanes:me', displayName: 'Kyle Richards' }), row(71335)];
    const card = decodeNativeBacklogDrag(encodeNativeBacklogDrag({ ...rows[0]!, group: rows }));
    expect(card?.group?.map((member) => member.source)).toEqual([
      { kind: 'backlog-item', id: 71360 },
      { kind: 'backlog-item', id: 71335 },
    ]);
    expect(card?.group?.[0]).toMatchObject({ label: '#71360', title: 'Backlog 71360', card: { kind: 'backlog-item', id: 71360, assignee: null, agentLane: null } });
    expect(Object.keys(activeDrag(card!, 'pointer').allowed)).toEqual(['planning', 'implementing']);
  });

  it('decodes one row without a group', () => {
    const card = decodeNativeBacklogDrag(encodeNativeBacklogDrag(row(71384)));
    expect(card).toMatchObject({ key: 'backlog:71384', source: { kind: 'backlog-item', id: 71384 } });
    expect(card?.group).toBeUndefined();
  });

  it('refuses data that is not a backlog drag', () => {
    for (const data of ['', 'not json', '{}', '{"rows":[]}', '{"rows":[{"id":-1,"title":"x"}]}', '{"rows":[{"id":"71360","title":"x"}]}', 'null']) {
      expect(decodeNativeBacklogDrag(data)).toBeNull();
    }
  });

  it('keeps at most 50 rows and cuts long titles', () => {
    const many = JSON.stringify({ rows: Array.from({ length: 60 }, (_, index) => ({ id: index + 1, title: 'x'.repeat(600) })) });
    const card = decodeNativeBacklogDrag(many);
    expect(card?.group).toHaveLength(50);
    expect(card?.title).toHaveLength(512);
  });

  it('lights the backlog lanes while a native drag is over the window', () => {
    expect(Object.keys(activeDrag(nativeBacklogPlaceholder(), 'pointer').allowed)).toEqual(['planning', 'implementing']);
  });
});
