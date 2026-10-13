import { describe, expect, it } from 'vitest';
import { eventLog, lines } from '../testing/output-events';
import { attributionOf, replayAttribution, replayEvents } from './attribution';
import { interleave, normaliseRelativePath } from './transcript-sources';

const LEAD = '71273';
const COMPANION = '71273-helper-docs';

describe('agent attribution (AL-276)', () => {
  it('credits the agent that wrote most of a file', () => {
    const log = eventLog(LEAD);
    log.edit('t1', 'src/Grid.razor', lines(3));
    log.edit('t2', 'src/Grid.razor', lines(10), 'agent-1');
    log.edit('t3', 'src/Grid.razor', lines(4));
    expect(replayEvents(LEAD, log.events).get('src/Grid.razor')).toEqual({ authorAgentId: 'agent-1', touchedBy: [LEAD, 'agent-1'] });
  });

  it('a tie goes to the agent that edited the file first', () => {
    const log = eventLog(LEAD);
    log.edit('t1', 'src/Grid.razor', lines(5), 'agent-2');
    log.edit('t2', 'src/Grid.razor', lines(5));
    log.edit('t3', 'src/Grid.razor', lines(2), 'agent-2');
    log.edit('t4', 'src/Grid.razor', lines(2));
    expect(replayEvents(LEAD, log.events).get('src/Grid.razor')).toEqual({ authorAgentId: 'agent-2', touchedBy: ['agent-2', LEAD] });
  });

  it('a file with no recorded call has no author (you edited it, or a merge brought it in)', () => {
    const log = eventLog(LEAD);
    log.edit('t1', 'src/Grid.razor', lines(2));
    log.bash('t2', 'sed -i s/a/b/ src/Other.cs');
    const map = replayEvents(LEAD, log.events);
    expect(map.has('src/Other.cs')).toBe(false);
    expect(attributionOf(map, 'src/Other.cs')).toEqual({ authorAgentId: null, touchedBy: [] });
  });

  it('a call that failed writes nothing', () => {
    const log = eventLog(LEAD);
    log.edit('t1', 'src/Grid.razor', lines(50), 'agent-1');
    log.result('t1', true, 'agent-1');
    log.edit('t2', 'src/Grid.razor', lines(2));
    log.result('t2');
    expect(replayEvents(LEAD, log.events).get('src/Grid.razor')).toEqual({ authorAgentId: LEAD, touchedBy: [LEAD] });
    const onlyFailed = eventLog(LEAD);
    onlyFailed.write('w1', 'src/New.cs', lines(9));
    onlyFailed.result('w1', true);
    expect(replayEvents(LEAD, onlyFailed.events).size).toBe(0);
  });

  it('a Write counts the whole new file, an Edit only its new text', () => {
    const log = eventLog(LEAD);
    log.write('w1', 'src/Grid.razor', lines(40));
    log.edit('t1', 'src/Grid.razor', lines(30), 'agent-1');
    // 40 lines written by the lead beat the 30 of the sub-agent, however small the lead's later edits.
    expect(replayEvents(LEAD, log.events).get('src/Grid.razor')?.authorAgentId).toBe(LEAD);
    log.edit('t2', 'src/Grid.razor', lines(11), 'agent-1');
    expect(replayEvents(LEAD, log.events).get('src/Grid.razor')?.authorAgentId).toBe('agent-1');
  });

  it('counts the lines of a MultiEdit from its input', () => {
    const log = eventLog(LEAD);
    log.multiEdit('m1', 'src/Grid.razor', [lines(4), lines(5)], 'agent-1');
    log.edit('t1', 'src/Grid.razor', lines(8));
    expect(replayEvents(LEAD, log.events).get('src/Grid.razor')?.authorAgentId).toBe('agent-1');
  });

  it('credits a sub-agent by its parent tool use id, and keeps the credit', () => {
    const log = eventLog(LEAD);
    log.edit('t1', 'src/Grid.razor', lines(20), 'toolu_razor');
    log.bash('t2', 'git merge sub/71273-razor');
    log.edit('t3', 'src/Grid.razor', lines(3));
    expect(replayEvents(LEAD, log.events).get('src/Grid.razor')).toEqual({ authorAgentId: 'toolu_razor', touchedBy: ['toolu_razor', LEAD] });
  });

  it("includes a second agent's transcript, credited to its own ticket id", () => {
    const lead = eventLog(LEAD, 1_000);
    lead.edit('t1', 'src/Grid.razor', lines(5));
    lead.edit('t2', 'docs/Grid.md', lines(2));
    const helper = eventLog(COMPANION, 2_000);
    helper.edit('h1', 'docs/Grid.md', lines(12));
    helper.edit('h2', 'docs/Grid.md', lines(1), 'toolu_inside');
    const map = replayAttribution([
      { agentId: LEAD, events: lead.events },
      { agentId: COMPANION, events: helper.events },
    ]);
    expect(map.get('src/Grid.razor')).toEqual({ authorAgentId: LEAD, touchedBy: [LEAD] });
    expect(map.get('docs/Grid.md')).toEqual({ authorAgentId: COMPANION, touchedBy: [LEAD, COMPANION, 'toolu_inside'] });
  });

  it('orders the first editor across transcripts by time, history (at 0) first', () => {
    const lead = eventLog(LEAD, 5_000);
    lead.edit('t1', 'a.cs', lines(3));
    const helper = eventLog(COMPANION, 1_000);
    helper.edit('h1', 'a.cs', lines(3));
    // The lead's transcript is listed first, but the helper edited earlier.
    const map = replayAttribution([
      { agentId: LEAD, events: lead.events },
      { agentId: COMPANION, events: helper.events },
    ]);
    expect(map.get('a.cs')).toEqual({ authorAgentId: COMPANION, touchedBy: [COMPANION, LEAD] });
  });

  it('replaying the same events gives the same map, however many times and in pieces', () => {
    const log = eventLog(LEAD);
    log.edit('t1', 'src/A.cs', lines(3));
    log.write('t2', 'src/B.cs', lines(7), 'toolu_x');
    log.edit('t3', 'src/A.cs', lines(3), 'toolu_x');
    log.result('t3', true, 'toolu_x');
    log.edit('t4', 'src\\A.cs', lines(1));
    const first = replayEvents(LEAD, log.events);
    expect(replayEvents(LEAD, [...log.events])).toEqual(first);
    // A row delivered twice (history overlapping live output) counts once.
    expect(replayEvents(LEAD, [...log.events, ...log.events])).toEqual(first);
    expect([...first.entries()]).toEqual([
      ['src/A.cs', { authorAgentId: LEAD, touchedBy: [LEAD] }],
      ['src/B.cs', { authorAgentId: 'toolu_x', touchedBy: ['toolu_x'] }],
    ]);
  });

  it('reads paths with backslashes, a leading ./ and the worktree prefix', () => {
    const log = eventLog(LEAD);
    log.edit('t1', '.\\src\\Grid.razor', lines(1));
    log.edit('t2', 'C:\\src\\.agent-lanes\\71273\\src\\Other.cs', lines(1));
    log.edit('t3', 'C:\\elsewhere\\Outside.cs', lines(1));
    const map = replayEvents(LEAD, log.events, 'C:\\src\\.agent-lanes\\71273');
    expect([...map.keys()]).toEqual(['src/Grid.razor', 'src/Other.cs']);
  });

  it('finds an entry by a differing case, and by the old path of a rename', () => {
    const log = eventLog(LEAD);
    log.edit('t1', 'src/grid.razor', lines(2));
    log.edit('t2', 'src/Old.cs', lines(2), 'agent-1');
    const map = replayEvents(LEAD, log.events);
    expect(attributionOf(map, 'src/Grid.razor').authorAgentId).toBe(LEAD);
    expect(attributionOf(map, 'src/New.cs', 'src/Old.cs').authorAgentId).toBe('agent-1');
  });

  it('ignores reads, shell commands and results of other calls', () => {
    const log = eventLog(LEAD);
    log.read('r1', 'src/Grid.razor');
    log.bash('b1', 'dotnet build');
    log.result('b1', true);
    expect(replayEvents(LEAD, log.events).size).toBe(0);
  });
});

describe('transcript source helpers', () => {
  it('normalises paths', () => {
    expect(normaliseRelativePath('./a/b.cs')).toBe('a/b.cs');
    expect(normaliseRelativePath('a\\b\\..\\c.cs')).toBe('a/c.cs');
    expect(normaliseRelativePath('../x.cs')).toBeNull();
    expect(normaliseRelativePath('/etc/x')).toBeNull();
    expect(normaliseRelativePath('   ')).toBeNull();
    expect(normaliseRelativePath('c:\\src\\wt\\a.cs', 'C:\\src\\wt')).toBe('a.cs');
  });

  it('interleaves transcripts by time and keeps each one in order', () => {
    const a = eventLog('a', 10);
    a.text('a1');
    a.text('a2');
    const b = eventLog('b', 10);
    b.text('b1');
    const order = interleave([{ events: a.events }, { events: b.events }]).map(({ event }) => (event.item.kind === 'text' ? event.item.text : ''));
    expect(order).toEqual(['a1', 'b1', 'a2']);
  });
});
