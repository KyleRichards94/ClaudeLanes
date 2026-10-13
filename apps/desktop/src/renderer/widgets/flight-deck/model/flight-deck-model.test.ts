import { describe, expect, it } from 'vitest';
import { baseName, compactTokens, countOf, formatCost, formatDuration, formatTurnDuration, initialOf, readableOn } from '../lib/format';
import { barShares, changeTiles, legendEntries, shownFile, tileTooltip } from './change-map';
import { DONUT_COLORS, donutSegments, stateCounts, tokenShare } from './donut';
import { agents, file, files, gates, LEAD, reviewStatus, steps, turn, turns } from './fixture';
import { doneMeta, reviewProgress, stageTurns, workflowStages } from './stage-meta';
import { turnSegments, turnTotalLabel, TURN_MIN_WIDTH } from './turn-strip';

describe('formatting', () => {
  it('writes stage and turn lengths, costs and counts the way the cards do', () => {
    expect(formatDuration(30_000)).toBe('<1m');
    expect(formatDuration(12 * 60_000)).toBe('12m');
    expect(formatDuration(72 * 60_000)).toBe('1h 12m');
    expect(formatTurnDuration(48_000)).toBe('48s');
    expect(formatTurnDuration(252_000)).toBe('4m 12s');
    expect(formatCost(2.064)).toBe('$2.06');
    expect(formatCost(0.004)).toBe('<$0.01');
    expect(formatCost(0)).toBe('$0.00');
    expect(countOf(1, 'turn')).toBe('1 turn');
    expect(countOf(7, 'turn')).toBe('7 turns');
    expect(compactTokens(850)).toBe('850');
    expect(compactTokens(212_000)).toBe('212k');
    expect(compactTokens(1_400_000)).toBe('1.4M');
    expect(baseName('src/Pages/FailedSyncFiles.razor')).toBe('FailedSyncFiles.razor');
    expect(initialOf('razor-writer')).toBe('R');
  });

  it('picks white or the ink so text on an agent colour reads at 4.5:1', () => {
    expect(readableOn('#5B4BC4')).toBe('#FFFFFF');
    // Teal and the neutral grey are too light for white.
    expect(readableOn('#0D9488')).not.toBe('#FFFFFF');
    expect(readableOn('#94A3B8')).not.toBe('#FFFFFF');
  });
});

describe('workflowStages (handoff: workflow card)', () => {
  const input = { steps, gates, waitingStage: null, turns, progress: null, review: null };

  it('gives a done stage "{duration} · {turns} turns · ${cost}", from the turns that started in it', () => {
    const [planning] = workflowStages(input);
    expect(planning).toMatchObject({ stage: 'planning', state: 'done', meta: '12m · 2 turns · $0.30', gateLabel: 'Approved', gateTone: 'ok' });
    expect(planning!.name).toBe('Planning, done, 12m');
    expect(stageTurns(turns, 'implementing')).toMatchObject({ count: 5 });
    expect(doneMeta(null, { count: 0, costUsd: 0 })).toBe('Done');
    expect(doneMeta(60_000, { count: 1, costUsd: 0.5 })).toBe('1m · 1 turn · $0.50');
  });

  it('gives the current stage a progress line and bar: the reported progress, or none (indeterminate)', () => {
    const [, implementing] = workflowStages(input);
    expect(implementing).toMatchObject({ state: 'current', meta: 'Working…', progress: null, name: 'Implementing, current stage' });

    const [, withProgress] = workflowStages({ ...input, progress: 0.46 });
    expect(withProgress).toMatchObject({ meta: '46% done', progress: 0.46, name: 'Implementing, current stage, 46%' });
  });

  it('measures Code review by the files reviewed over the files changed', () => {
    const codeReview = workflowStages({
      ...input,
      steps: steps.map((step) => (step.stage === 'planning' || step.stage === 'implementing' ? { ...step, state: 'done' as const, durationMs: 1 } : step.stage === 'code-review' ? { ...step, state: 'current' as const } : step)),
      progress: 0.9,
      review: reviewProgress(files.map((f) => f.path), reviewStatus),
    })[2]!;
    // Two of five files are reviewed (one passed, one with changes requested); the third is only in review.
    expect(codeReview).toMatchObject({ stage: 'code-review', meta: '2 of 5 files reviewed', progress: 0.4 });
    expect(reviewProgress([], {})).toEqual({ reviewed: 0, total: 0 });
  });

  it('says what comes next for stages to come, and that a gated one waits for you', () => {
    const stages = workflowStages(input);
    const byStage = Object.fromEntries(stages.map((stage) => [stage.stage, stage]));
    expect(byStage['code-review']).toMatchObject({ state: 'upcoming', meta: 'reviews the diff', gateLabel: 'Auto', gateTone: 'neutral' });
    expect(byStage['qa']!.meta).toBe('QA runs next');
    // Create PR is gated by default.
    expect(byStage['create-pr']).toMatchObject({ meta: 'waits for you', gateLabel: 'Approval', gateTone: 'attention' });
  });

  it('marks the stage whose gate waits for the user', () => {
    const waiting = workflowStages({ ...input, waitingStage: 'implementing' }).find((stage) => stage.stage === 'implementing')!;
    expect(waiting).toMatchObject({ waiting: true, meta: 'Waiting for your approval' });
    expect(waiting.name).toMatch(/waiting for approval$/);
  });
});

describe('turnSegments', () => {
  it('sizes a turn by its minutes, colours it by its lead agent, and gives the live one the gradient', () => {
    const segments = turnSegments(turns, agents);
    expect(segments).toHaveLength(7);
    expect(segments[2]).toMatchObject({ index: 3, grow: 8, fill: '#5B4BC4', label: 'T3', cost: '$0.50', live: false });
    // Turn 4 was led by the razor writer, turn 5 by the tester.
    expect(segments[3]!.fill).toBe('#0369A1');
    expect(segments[4]!.fill).toBe('#0D9488');
    expect(segments[6]).toMatchObject({ index: 7, fill: null, live: true, cost: 'live', ink: '#FFFFFF' });
    expect(segments[2]!.name).toBe('Turn 3, 8m 00s, $0.50, led by Lead');
    expect(TURN_MIN_WIDTH).toBe(26);
  });

  it('never gives a turn with no length less than a sliver, and greys an agent it does not know', () => {
    const [short, stray] = turnSegments([turn(1, { durationMs: 0 }), turn(2, { leadAgentId: 'gone' })], agents);
    expect(short!.grow).toBeGreaterThan(0);
    expect(stray).toMatchObject({ fill: '#94A3B8', agentName: 'an earlier agent' });
  });

  it('totals the turns as "7 turns · $2.06"', () => {
    expect(turnTotalLabel(turns)).toBe('7 turns · $2.06');
    expect(turnTotalLabel(turns.slice(0, 1))).toBe('1 turn · $0.20');
  });
});

describe('changeTiles (handoff: change map)', () => {
  it('lays tiles out by lines changed, biggest first, with width = lines changed and the author colour', () => {
    const tiles = changeTiles(files, agents);
    expect(tiles.map((tile) => tile.name)).toEqual(['FailedSyncFiles.razor', 'FailedSyncFilesTests.cs', 'frmFailedFiles.vb', 'FailedSyncFiles.razor.cs', 'CompanionGridFormatter.cs']);
    expect(tiles.map((tile) => tile.grow)).toEqual([120, 64, 47, 40, 7]);
    expect(tiles[0]).toMatchObject({ authorColor: '#5B4BC4', authorName: 'Lead' });
    expect(tiles[1]).toMatchObject({ authorColor: '#0D9488', authorName: 'test-writer' });
    // No recorded author: grey, "by you or a merge".
    expect(tiles[2]).toMatchObject({ authorColor: '#94A3B8', authorName: 'you or a merge' });
    expect(tiles[2]!.label).toContain('by you or a merge');
  });

  it('splits the bar green and red by lines, all red for a deleted file and none for a binary one', () => {
    expect(barShares({ kind: 'modified', added: 3, removed: 1 })).toEqual({ addedPercent: 75, removedPercent: 25 });
    expect(barShares({ kind: 'deleted', added: 0, removed: 20 })).toEqual({ addedPercent: 0, removedPercent: 100 });
    expect(barShares({ kind: 'binary', added: 0, removed: 0 })).toEqual({ addedPercent: 0, removedPercent: 0 });
  });

  it('marks a rename and a binary file, and keeps one unit of width for a file with no counted lines', () => {
    const tiles = changeTiles([file('a/New.cs', 4, 1, { kind: 'renamed', oldPath: 'a/Old.cs' }), file('img/logo.png', 0, 0, { kind: 'binary' }), file('empty.txt', 0, 0)], agents);
    expect(tiles.find((tile) => tile.renamed)!.tooltip).toBe('a/New.cs (renamed from a/Old.cs)\n+4 −1 · by Lead');
    expect(tiles.find((tile) => tile.binary)).toMatchObject({ grow: 1, kind: 'binary' });
    expect(tiles.find((tile) => tile.name === 'empty.txt')!.grow).toBe(1);
    expect(tileTooltip(file('x.bin', 0, 0, { kind: 'binary' }), 'Lead')).toBe('x.bin\nbinary file · by Lead');
  });

  it('lists in the legend only the agents that wrote a changed file, then "you or a merge"', () => {
    expect(legendEntries(files, agents).map((entry) => entry.name)).toEqual(['Lead', 'razor-writer', 'test-writer', 'you or a merge']);
    expect(legendEntries([file('a.cs', 1, 0, { authorAgentId: 'gone' })], agents).map((entry) => entry.name)).toEqual(['An earlier agent']);
  });

  it('shows the selected file, else the one that changed most', () => {
    expect(shownFile(files, 'tests/FailedSyncFilesTests.cs')!.path).toBe('tests/FailedSyncFilesTests.cs');
    expect(shownFile(files, null)!.path).toBe('src/Pages/Companion/FailedSyncFiles.razor');
    expect(shownFile(files, 'gone.cs')!.path).toBe('src/Pages/Companion/FailedSyncFiles.razor');
    expect(shownFile([], null)).toBeNull();
  });
});

describe('donut (handoff: Agents card)', () => {
  it('counts agents by state, the lead on its own', () => {
    expect(stateCounts(agents)).toEqual({ lead: 1, running: 1, done: 1, idle: 1, error: 0 });
    expect(stateCounts([])).toEqual({ lead: 0, running: 0, done: 0, idle: 0, error: 0 });
  });

  it('draws one segment per agent, coloured by state, and pulses the running ones', () => {
    const segments = donutSegments(agents);
    expect(segments.map((segment) => [segment.id, segment.state, segment.color, segment.pulse])).toEqual([
      [LEAD, 'lead', '#5B4BC4', true],
      ['writer', 'running', '#818CF8', true],
      ['tester', 'done', '#34D399', false],
      ['eyes', 'idle', DONUT_COLORS.idle, false],
    ]);
    // Equal arcs, each starting where the last ended.
    const offsets = segments.map((segment) => segment.dashOffset);
    expect(offsets[0]).toBe(0);
    expect(offsets[1]! - offsets[0]!).toBeCloseTo(offsets[2]! - offsets[1]!, 1);
  });

  it('draws a lone agent as a full ring', () => {
    const [only] = donutSegments([agents[0]!]);
    const [drawn, rest] = only!.dashArray.split(' ').map(Number);
    expect(drawn! + rest!).toBeCloseTo(2 * Math.PI * 39.5, 1);
    expect(rest).toBeCloseTo(0, 1);
  });

  it("measures tokens as a share of the busiest agent's", () => {
    expect(tokenShare(106_000, 212_000)).toBe(0.5);
    expect(tokenShare(null, 212_000)).toBeNull();
    expect(tokenShare(0, 212_000)).toBeNull();
    expect(tokenShare(5, 0)).toBeNull();
  });
});
