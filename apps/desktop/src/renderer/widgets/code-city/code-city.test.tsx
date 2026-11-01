import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ChangedFile } from '@agent-lanes/contracts';
import { color, tone } from '@agent-lanes/tokens';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureAgents, fixtureFiles, fixtureFindings, FIXTURE_BASE, FIXTURE_PATHS, fixtureReviewStatus, fixtureStages } from './model/fixture';
import type { CodeCityProps } from './model/types';
import { CodeCity } from './ui/CodeCity';

/** Reading order of the reference ticket: district by district, biggest file first. */
const ORDER: string[] = [FIXTURE_PATHS.razor, FIXTURE_PATHS.razorCs, FIXTURE_PATHS.tests, FIXTURE_PATHS.legacy, FIXTURE_PATHS.formatter];

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function setWindowWidth(width: number) {
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

function props(overrides: Partial<CodeCityProps> = {}): CodeCityProps {
  return {
    files: fixtureFiles,
    base: FIXTURE_BASE,
    loading: false,
    error: null,
    onRetry: vi.fn(),
    agents: fixtureAgents,
    reviewStatus: fixtureReviewStatus,
    findings: fixtureFindings,
    selectedFilePath: null,
    onSelectFile: vi.fn(),
    followAgent: false,
    latestActivityPath: null,
    diffMode: 'unified',
    onDiffModeChange: vi.fn(),
    stages: fixtureStages,
    legendDismissed: false,
    onDismissLegend: vi.fn(),
    renderDiff: vi.fn((file: ChangedFile, mode: string, stripe: string) => <span data-testid="diff">{`${file.path}|${mode}|${stripe}`}</span>),
    composer: <span>composer slot</span>,
    worktree: <span>worktree slot</span>,
    onOpenPrThread: vi.fn(),
    ...overrides,
  };
}

const options = () => screen.getAllByRole('option');
const nameOf = (path: string) => `${path.split('/').pop()}`;
const optionFor = (path: string) => options().find((o) => o.getAttribute('data-path') === path) as HTMLElement;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  setWindowWidth(1440);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('CodeCity listbox', () => {
  it('is a listbox of changed files with one option per file and a single Tab stop', () => {
    render(<CodeCity {...props()} />);
    const list = screen.getByRole('listbox', { name: 'Changed files' });
    expect(within(list).getAllByRole('option')).toHaveLength(5);
    expect(options().filter((o) => o.tabIndex === 0)).toHaveLength(1);
    // The first building in reading order is the tab stop until something is selected.
    expect(options().find((o) => o.tabIndex === 0)?.getAttribute('data-path')).toBe(ORDER[0]);
  });

  it('names every building "{file}, {district}, {added} lines added, {removed} removed, by {agent}, {review}"', () => {
    render(<CodeCity {...props()} />);
    expect(optionFor(FIXTURE_PATHS.razor).getAttribute('aria-label')).toBe('FailedSyncFiles.razor, ComponentLibrary / Pages, 120 lines added, 0 removed, by lead, In review');
    expect(optionFor(FIXTURE_PATHS.legacy).getAttribute('aria-label')).toBe('frmFailedFiles.vb, Legacy.WinExe / OfflineSynchronisation, 3 lines added, 44 removed, by legacy, Not reviewed');
    expect(optionFor(FIXTURE_PATHS.tests).getAttribute('aria-label')).toBe('FailedSyncFilesTests.cs, Tests / Companion, 64 lines added, 0 removed, by tester, Passed');
    expect(optionFor(FIXTURE_PATHS.razorCs).getAttribute('aria-label')).toContain('Changes requested');
  });

  it('names an unknown author "you or a merge"', () => {
    const files = fixtureFiles.map((f) => (f.path === FIXTURE_PATHS.formatter ? { ...f, authorAgentId: null } : f));
    render(<CodeCity {...props({ files })} />);
    expect(optionFor(FIXTURE_PATHS.formatter).getAttribute('aria-label')).toContain('by you or a merge');
  });

  it('moves with the arrow keys in reading order, Home and End, and roves the tab stop', () => {
    render(<CodeCity {...props()} />);
    optionFor(ORDER[0]!).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(optionFor(ORDER[1]!));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(optionFor(ORDER[2]!));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(optionFor(ORDER[1]!));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(optionFor(ORDER[4]!));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(optionFor(ORDER[4]!));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(optionFor(ORDER[0]!));
    expect(options().filter((o) => o.tabIndex === 0)).toHaveLength(1);
    expect(optionFor(ORDER[0]!).tabIndex).toBe(0);
  });

  it('selects with Enter and Space and clears with Escape', () => {
    const onSelectFile = vi.fn();
    render(<CodeCity {...props({ onSelectFile })} />);
    const second = optionFor(ORDER[1]!);
    second.focus();
    fireEvent.keyDown(second, { key: 'Enter' });
    expect(onSelectFile).toHaveBeenLastCalledWith(ORDER[1]);
    fireEvent.keyDown(second, { key: ' ' });
    expect(onSelectFile).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(second, { key: 'Escape' });
    expect(onSelectFile).toHaveBeenLastCalledWith(null);
  });

  it('selects on a click and clears on a click on empty ground', () => {
    const onSelectFile = vi.fn();
    const { container } = render(<CodeCity {...props({ onSelectFile })} />);
    fireEvent.click(optionFor(FIXTURE_PATHS.tests));
    expect(onSelectFile).toHaveBeenLastCalledWith(FIXTURE_PATHS.tests);
    fireEvent.click(container.querySelector('.cc-ground')!);
    expect(onSelectFile).toHaveBeenLastCalledWith(null);
  });

  it('marks the selected building aria-selected and makes it the tab stop', () => {
    render(<CodeCity {...props({ selectedFilePath: FIXTURE_PATHS.tests })} />);
    expect(optionFor(FIXTURE_PATHS.tests).getAttribute('aria-selected')).toBe('true');
    expect(optionFor(FIXTURE_PATHS.razor).getAttribute('aria-selected')).toBe('false');
    expect(optionFor(FIXTURE_PATHS.tests).tabIndex).toBe(0);
  });

  it('builds each building from shadow, s, e, top, win with the face colour variables', () => {
    render(<CodeCity {...props()} />);
    const razor = optionFor(FIXTURE_PATHS.razor);
    expect(Array.from(razor.children).map((c) => c.className)).toEqual(['shadow', 's', 'e', 'top', 'win']);
    expect(razor.style.getPropertyValue('--h')).toBe('162px');
    expect(razor.style.getPropertyValue('--c1')).not.toBe('');
    expect(razor.style.width).toBe('100px');
  });
});

describe('CodeCity overlays', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      // Spread the buildings out so only some labels overlap.
      const index = ORDER.indexOf(this.closest('[data-path]')?.getAttribute('data-path') ?? this.getAttribute('data-path') ?? '');
      const left = 100 + Math.max(index, 0) * 40;
      return { left, top: 300, width: 60, height: 60, right: left + 60, bottom: 360, x: left, y: 300, toJSON: () => ({}) } as DOMRect;
    });
  });

  it('puts a chip with name, +added and −removed over every building, and a district label per plot', async () => {
    const { container } = render(<CodeCity {...props()} />);
    await waitFor(() => expect(container.querySelectorAll('.cc-chip').length).toBeGreaterThan(0));
    const razorChip = container.querySelector('[data-chip="b:' + FIXTURE_PATHS.razor + '"]')!;
    expect(razorChip.textContent).toBe('FailedSyncFiles.razor+120−0');
    expect(razorChip.querySelector('.add')?.textContent).toBe('+120');
    expect(razorChip.querySelector('.del')?.textContent).toBe('−0');
    const rubble = container.querySelector('[data-chip="r:' + FIXTURE_PATHS.legacy + '"]')!;
    expect(rubble.textContent).toBe('demolished −44');
    expect(Array.from(container.querySelectorAll('.cc-district')).map((d) => d.textContent)).toContain('ComponentLibrary / Pages');
  });

  it('shows a tooltip with path, counts, author and review status after the pointer rests on a building', async () => {
    const { container } = render(<CodeCity {...props()} />);
    await waitFor(() => expect(container.querySelectorAll('.cc-chip').length).toBeGreaterThan(0));
    fireEvent.mouseEnter(optionFor(FIXTURE_PATHS.razor));
    expect(screen.queryByTestId('city-tooltip')).toBeNull();
    const tip = await screen.findByTestId('city-tooltip');
    expect(tip.textContent).toBe(`${FIXTURE_PATHS.razor}+120 −0 · by lead · In review`);
    fireEvent.mouseLeave(optionFor(FIXTURE_PATHS.razor));
    expect(screen.queryByTestId('city-tooltip')).toBeNull();
  });

  it('brings the label of the building under the pointer to the front, and takes it back on leave', async () => {
    const { container } = render(<CodeCity {...props()} />);
    await waitFor(() => expect(container.querySelectorAll('.cc-chip').length).toBeGreaterThan(0));
    const chip = () => container.querySelector('[data-chip="b:' + FIXTURE_PATHS.tests + '"]')!;
    expect(chip().classList.contains('front')).toBe(false);
    fireEvent.mouseEnter(optionFor(FIXTURE_PATHS.tests));
    expect(chip().classList.contains('front')).toBe(true);
    fireEvent.mouseLeave(optionFor(FIXTURE_PATHS.tests));
    expect(chip().classList.contains('front')).toBe(false);
  });

  it('selects the building when its label chip is clicked', async () => {
    const onSelectFile = vi.fn();
    const { container } = render(<CodeCity {...props({ onSelectFile })} />);
    await waitFor(() => expect(container.querySelector('[data-chip="b:' + FIXTURE_PATHS.tests + '"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-chip="b:' + FIXTURE_PATHS.tests + '"]')!);
    expect(onSelectFile).toHaveBeenCalledWith(FIXTURE_PATHS.tests);
  });

  it('nudges overlapping labels up so no two chips share a spot', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 200, top: 300, width: 60, height: 60, right: 260, bottom: 360, x: 200, y: 300, toJSON: () => ({}) } as DOMRect);
    const { container } = render(<CodeCity {...props()} />);
    await waitFor(() => expect(container.querySelectorAll('.cc-chip').length).toBeGreaterThan(1));
    const tops = Array.from(container.querySelectorAll<HTMLElement>('.cc-chip')).map((c) => c.style.top);
    expect(new Set(tops).size).toBeGreaterThan(1);
  });

  it('pins running agents over the file they are on, with a verb', async () => {
    const { container } = render(<CodeCity {...props()} />);
    await waitFor(() => expect(container.querySelectorAll('.cc-pin').length).toBe(2));
    const pins = Array.from(container.querySelectorAll('.cc-pin')).map((p) => p.querySelector('.cc-pill')?.textContent);
    expect(pins).toEqual(['builder · building', 'reviewer · inspecting']);
  });

  it('shows no pins when the session has ended', async () => {
    const agents = fixtureAgents.map((a) => ({ ...a, status: 'done' as const }));
    const { container } = render(<CodeCity {...props({ agents })} />);
    await waitFor(() => expect(container.querySelectorAll('.cc-chip').length).toBeGreaterThan(0));
    expect(container.querySelectorAll('.cc-pin')).toHaveLength(0);
    const crew = within(screen.getByTestId('city-crew'));
    expect(crew.getAllByText('Off shift')).toHaveLength(5);
  });

  it('shows a tall badge on a label over 180 added lines, capped at 240px', async () => {
    const files = fixtureFiles.map((f) => (f.path === FIXTURE_PATHS.razor ? { ...f, added: 400 } : f));
    const { container } = render(<CodeCity {...props({ files })} />);
    await waitFor(() => expect(container.querySelector('[data-chip="b:' + FIXTURE_PATHS.razor + '"] .tall')).not.toBeNull());
    expect(optionFor(FIXTURE_PATHS.razor).style.getPropertyValue('--h')).toBe('240px');
  });

  it('draws only rubble for a deleted file and labels it "{name} deleted −{removed}"', async () => {
    const gone: ChangedFile = { path: 'OnSiteCompanion/Tests/Companion/Old.cs', oldPath: null, kind: 'deleted', added: 0, removed: 30, authorAgentId: null, touchedBy: [], uncommitted: false };
    const { container } = render(<CodeCity {...props({ files: [...fixtureFiles, gone] })} />);
    const option = optionFor(gone.path);
    expect(option.className).toContain('cc-rubble');
    expect(container.querySelectorAll('.cc-b[data-path="' + gone.path + '"]')).toHaveLength(0);
    await waitFor(() => expect(container.querySelector('[data-chip="r:' + gone.path + '"]')).not.toBeNull());
    expect(container.querySelector('[data-chip="r:' + gone.path + '"]')?.textContent).toBe('Old.cs deleted −30');
  });

  it('puts a dashed amber outline class on an uncommitted building and shows the chip in the rail', () => {
    const files = fixtureFiles.map((f) => (f.path === FIXTURE_PATHS.tests ? { ...f, uncommitted: true } : f));
    render(<CodeCity {...props({ files })} />);
    expect(optionFor(FIXTURE_PATHS.tests).className).toContain('uncommitted');
    expect(optionFor(FIXTURE_PATHS.razor).className).not.toContain('uncommitted');
    expect(screen.getByText('Includes uncommitted changes')).toBeTruthy();
  });

  it('draws a binary file as a slab', () => {
    const bin: ChangedFile = { path: 'OnSiteCompanion/Tests/Companion/logo.png', oldPath: null, kind: 'binary', added: 0, removed: 0, authorAgentId: null, touchedBy: [], uncommitted: false };
    render(<CodeCity {...props({ files: [...fixtureFiles, bin], selectedFilePath: bin.path })} />);
    const slab = optionFor(bin.path);
    expect(slab.className).toContain('slab');
    expect(slab.style.getPropertyValue('--h')).toBe('10px');
    expect(screen.getAllByText('Binary file — no diff').length).toBeGreaterThan(0);
  });

  it('collapses files over 40 into a "{n} more files" plot with a plain file list', async () => {
    const many: ChangedFile[] = Array.from({ length: 46 }, (_, i) => ({
      path: `src/area${i % 2}/file${String(i).padStart(2, '0')}.ts`,
      oldPath: null,
      kind: 'modified',
      added: 10 + i,
      removed: 0,
      authorAgentId: null,
      touchedBy: [],
      uncommitted: false,
    }));
    const onSelectFile = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 200, top: 300, width: 60, height: 60, right: 260, bottom: 360, x: 200, y: 300, toJSON: () => ({}) } as DOMRect);
    render(<CodeCity {...props({ files: many, onSelectFile })} />);
    expect(options()).toHaveLength(40);
    const more = await screen.findByRole('button', { name: '6 more files' });
    fireEvent.click(more);
    const popover = screen.getByRole('dialog', { name: '6 more files' });
    expect(within(popover).getAllByRole('button')).toHaveLength(6);
    fireEvent.click(within(popover).getAllByRole('button')[0]!);
    expect(onSelectFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('announces pin moves in a polite live region, at most once every 5 seconds', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const first = props();
    const { rerender } = render(<CodeCity {...first} />);
    const live = screen.getByTestId('city-live');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe('');
    const moved = (path: string) => fixtureAgents.map((a) => (a.id === 'reviewer' ? { ...a, activeFile: path } : a));
    rerender(<CodeCity {...first} agents={moved(FIXTURE_PATHS.tests)} />);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(live.textContent).toBe('reviewer is inspecting FailedSyncFilesTests.cs');
    // Moves again at once: held back until 5 s after the last announcement.
    rerender(<CodeCity {...first} agents={moved(FIXTURE_PATHS.legacy)} />);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(live.textContent).toBe('reviewer is inspecting FailedSyncFilesTests.cs');
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(live.textContent).toBe('reviewer is inspecting frmFailedFiles.vb');
  });
});

describe('CodeCity crew panel', () => {
  it('lists every agent with its model and a status word', () => {
    render(<CodeCity {...props()} />);
    const crew = within(screen.getByTestId('city-crew'));
    expect(crew.getByText('Crew on site')).toBeTruthy();
    for (const a of fixtureAgents) expect(crew.getByText(a.name)).toBeTruthy();
    expect(crew.getByText('Directing')).toBeTruthy();
    expect(crew.getByText('Building')).toBeTruthy();
    expect(crew.getByText('Inspecting')).toBeTruthy();
    expect(crew.getAllByText('Off shift')).toHaveLength(2);
  });

  it('selects the active building when a row is pressed', () => {
    const onSelectFile = vi.fn();
    render(<CodeCity {...props({ onSelectFile })} />);
    fireEvent.click(screen.getByRole('button', { name: /^reviewer, Inspecting/ }));
    expect(onSelectFile).toHaveBeenCalledWith(FIXTURE_PATHS.razor);
  });

  it('says Reading for an agent whose active file is not in the diff, and gives it no pin', async () => {
    const agents = fixtureAgents.map((a) => (a.id === 'builder' ? { ...a, activeFile: 'OnSiteCompanion/Other/Unchanged.cs', activeKind: 'read' as const } : a));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 200, top: 300, width: 60, height: 60, right: 260, bottom: 360, x: 200, y: 300, toJSON: () => ({}) } as DOMRect);
    const { container } = render(<CodeCity {...props({ agents })} />);
    expect(within(screen.getByTestId('city-crew')).getByText('Reading')).toBeTruthy();
    await waitFor(() => expect(container.querySelectorAll('.cc-pin')).toHaveLength(1));
    expect(container.querySelector('.cc-pin')?.textContent).toContain('reviewer');
  });
});

describe('CodeCity how-to card and stage track', () => {
  it('shows the legend until it is dismissed', () => {
    const onDismissLegend = vi.fn();
    const { rerender } = render(<CodeCity {...props({ onDismissLegend })} />);
    const card = within(screen.getByTestId('city-howto'));
    expect(card.getByText('Code city')).toBeTruthy();
    expect(card.getByText(/Each building is a file\. Height = lines added, red ground = lines removed\./)).toBeTruthy();
    expect(card.getByText('Click a building to inspect its diff.')).toBeTruthy();
    fireEvent.click(card.getByRole('button', { name: 'Close the how-to card' }));
    expect(onDismissLegend).toHaveBeenCalledTimes(1);
    rerender(<CodeCity {...props({ onDismissLegend, legendDismissed: true })} />);
    expect(screen.queryByTestId('city-howto')).toBeNull();
  });

  it('shows the five stages with their captions and split progress', () => {
    render(<CodeCity {...props()} />);
    const track = within(screen.getByTestId('city-stage-track'));
    for (const stage of fixtureStages) {
      expect(track.getByText(stage.label)).toBeTruthy();
      expect(track.getAllByText(stage.caption).length).toBeGreaterThan(0);
    }
    const road = screen.getByTestId('city-road-codeReview');
    expect(road.getAttribute('style')).toContain('60%');
  });

  it('renders the composer and worktree slots', () => {
    render(<CodeCity {...props()} />);
    expect(screen.getByText('composer slot')).toBeTruthy();
    expect(screen.getByText('worktree slot')).toBeTruthy();
  });
});

describe('CodeCity inspector rail', () => {
  it('asks for a selection when nothing is selected', () => {
    render(<CodeCity {...props()} />);
    expect(screen.getByText('Select a building')).toBeTruthy();
    expect(screen.getByText('Select a building to see its diff.')).toBeTruthy();
    expect(screen.getByText('No notes yet.')).toBeTruthy();
  });

  it('reflects the selected building: stats, builder, review status and the diff', () => {
    const renderDiff = vi.fn((file: ChangedFile, mode: string, stripe: string) => <span data-testid="diff">{`${file.path}|${mode}|${stripe}`}</span>);
    render(<CodeCity {...props({ selectedFilePath: FIXTURE_PATHS.razor, renderDiff })} />);
    const inspector = within(screen.getByTestId('city-inspector'));
    expect(inspector.getByText('FailedSyncFiles.razor')).toBeTruthy();
    expect(inspector.getByText('ComponentLibrary / Pages · built by lead')).toBeTruthy();
    expect(within(screen.getByTestId('city-stat-added')).getByText('+120')).toBeTruthy();
    expect(within(screen.getByTestId('city-stat-added')).getByText('floors added')).toBeTruthy();
    expect(within(screen.getByTestId('city-stat-removed')).getByText('−0')).toBeTruthy();
    expect(within(screen.getByTestId('city-stat-removed')).getByText('demolished')).toBeTruthy();
    expect(within(screen.getByTestId('city-stat-review')).getByText('In review')).toBeTruthy();
    expect(within(screen.getByTestId('city-stat-review')).getByText('inspection')).toBeTruthy();
    expect(screen.getByTestId('diff').textContent).toBe(`${FIXTURE_PATHS.razor}|unified|#5B4BC4`);
  });

  it('shows the other review words and a grey "you or a merge" author', () => {
    const files = fixtureFiles.map((f) => (f.path === FIXTURE_PATHS.formatter ? { ...f, authorAgentId: null } : f));
    render(<CodeCity {...props({ files, selectedFilePath: FIXTURE_PATHS.formatter })} />);
    expect(screen.getByText('ComponentLibrary / Components · built by you or a merge')).toBeTruthy();
    expect(within(screen.getByTestId('city-stat-review')).getByText('Not reviewed')).toBeTruthy();
  });

  it('shows "renamed from" for a renamed file', () => {
    const renamed: ChangedFile = { ...fixtureFiles[3]!, kind: 'renamed', oldPath: 'OnSiteCompanion/ComponentLibrary/Pages/Old/FailedSyncFiles.razor.cs' };
    const files = fixtureFiles.map((f) => (f.path === renamed.path ? renamed : f));
    render(<CodeCity {...props({ files, selectedFilePath: renamed.path })} />);
    expect(screen.getByText('renamed from OnSiteCompanion/ComponentLibrary/Pages/Old/FailedSyncFiles.razor.cs')).toBeTruthy();
  });

  it('binds the Unified / Split toggle to diffMode', () => {
    const onDiffModeChange = vi.fn();
    render(<CodeCity {...props({ selectedFilePath: FIXTURE_PATHS.razor, onDiffModeChange })} />);
    expect(screen.getByRole('radio', { name: 'Unified' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Split' }));
    expect(onDiffModeChange).toHaveBeenCalledWith('split');
  });

  it('renders the inspector’s notes with severity colours and a Posted to PR link', () => {
    const onOpenPrThread = vi.fn();
    render(<CodeCity {...props({ selectedFilePath: FIXTURE_PATHS.razorCs, onOpenPrThread })} />);
    const notes = within(screen.getByTestId('city-notes'));
    expect(notes.getByText('reviewer · posts via /pr-comment-actioner')).toBeTruthy();
    expect(notes.getByText('Line 42:')).toBeTruthy();
    expect(notes.getByText('Line 77:')).toBeTruthy();
    expect(screen.getByTestId('city-note-warn').getAttribute('style')).toContain(tone.attention.band);
    expect(screen.getByTestId('city-note-error').getAttribute('style')).toContain(tone.danger.wash);
    expect(screen.getByTestId('city-note-info').getAttribute('style')).toContain(color.bg);
    const link = notes.getByRole('link', { name: /Posted to PR/ });
    fireEvent.click(link);
    expect(onOpenPrThread).toHaveBeenCalledWith(4821);
    expect(notes.getAllByText('Posted to PR')).toHaveLength(1);
  });

  it('only shows the selected file’s notes', () => {
    render(<CodeCity {...props({ selectedFilePath: FIXTURE_PATHS.tests })} />);
    const notes = within(screen.getByTestId('city-notes'));
    expect(notes.getByText('Line 12:')).toBeTruthy();
    expect(notes.queryByText('Line 42:')).toBeNull();
  });
});

describe('CodeCity states', () => {
  it('shows a skeleton plane and skeleton rows while loading', () => {
    render(<CodeCity {...props({ files: [], loading: true })} />);
    expect(screen.getByTestId('city-skeleton')).toBeTruthy();
    expect(screen.getByTestId('city-rail-skeleton')).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.querySelectorAll('.cc-ghost')).toHaveLength(3);
  });

  it('shows the empty lot with the base, and the crew panel still lists the agents', () => {
    render(<CodeCity {...props({ files: [] })} />);
    expect(screen.getByText('Empty lot — no changes against main yet')).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(within(screen.getByTestId('city-crew')).getByText('reviewer')).toBeTruthy();
  });

  it('shows an error card with Retry, and the rail stays usable', () => {
    const onRetry = vi.fn();
    render(<CodeCity {...props({ files: [], error: { message: 'git diff failed' }, onRetry })} />);
    expect(screen.getByRole('alert').textContent).toContain('git diff failed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('city-rail')).toBeTruthy();
    expect(screen.getByText('worktree slot')).toBeTruthy();
    expect(screen.queryByTestId('city-rail-skeleton')).toBeNull();
  });
});

describe('CodeCity follow agent', () => {
  it('selects the file under the latest activity when Follow is on, once per change', () => {
    const onSelectFile = vi.fn();
    const base = props({ onSelectFile, followAgent: true, latestActivityPath: FIXTURE_PATHS.razor });
    const { rerender } = render(<CodeCity {...base} />);
    expect(onSelectFile).toHaveBeenCalledTimes(1);
    expect(onSelectFile).toHaveBeenLastCalledWith(FIXTURE_PATHS.razor);
    rerender(<CodeCity {...base} selectedFilePath={FIXTURE_PATHS.razor} />);
    expect(onSelectFile).toHaveBeenCalledTimes(1);
    rerender(<CodeCity {...base} latestActivityPath={FIXTURE_PATHS.razorCs} />);
    expect(onSelectFile).toHaveBeenCalledTimes(2);
    expect(onSelectFile).toHaveBeenLastCalledWith(FIXTURE_PATHS.razorCs);
  });

  it('does nothing when Follow is off, or for a path outside the diff', () => {
    const onSelectFile = vi.fn();
    const { rerender } = render(<CodeCity {...props({ onSelectFile, followAgent: false, latestActivityPath: FIXTURE_PATHS.razor })} />);
    expect(onSelectFile).not.toHaveBeenCalled();
    rerender(<CodeCity {...props({ onSelectFile, followAgent: true, latestActivityPath: 'not/in/the/diff.cs' })} />);
    expect(onSelectFile).not.toHaveBeenCalled();
  });
});

describe('CodeCity expanded blueprint diff', () => {
  const expand = () => fireEvent.click(screen.getByTestId('city-diff-expand'));

  it('opens the diff beside the city between two dividers, with the rest of the inspector at the right, and puts it back', () => {
    render(<CodeCity {...props({ selectedFilePath: FIXTURE_PATHS.razor })} />);
    expect(screen.queryByTestId('city-split')).toBeNull();
    expect(within(screen.getByTestId('city-rail')).getByTestId('city-diff')).toBeTruthy();

    expand();
    expect(screen.getByRole('separator', { name: 'Resize the city and the blueprint diff' })).toBeTruthy();
    expect(screen.getByRole('separator', { name: 'Resize the blueprint diff and the inspector' })).toBeTruthy();
    const pane = within(screen.getByTestId('city-diff-pane'));
    expect(pane.getByTestId('diff').textContent).toContain(FIXTURE_PATHS.razor);
    // The building card, notes and worktree stay in the rail; the diff left it.
    const rail = within(screen.getByTestId('city-rail'));
    expect(rail.getByTestId('city-inspector')).toBeTruthy();
    expect(rail.getByText('worktree slot')).toBeTruthy();
    expect(rail.queryByTestId('city-diff')).toBeNull();
    // The city, its stage track and the composer are still there.
    expect(screen.getByRole('listbox', { name: 'Changed files' })).toBeTruthy();
    expect(screen.getByText('composer slot')).toBeTruthy();

    fireEvent.click(pane.getByRole('button', { name: 'Move the blueprint diff back to the rail' }));
    expect(screen.queryByTestId('city-split')).toBeNull();
    expect(within(screen.getByTestId('city-rail')).getByTestId('city-diff')).toBeTruthy();
  });

  it('moves a divider with the arrow keys', () => {
    render(<CodeCity {...props()} />);
    expand();
    const divider = screen.getByRole('separator', { name: 'Resize the city and the blueprint diff' });
    const before = Number(divider.getAttribute('aria-valuenow'));
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(Number(divider.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
  });

  it('has no expand button in the narrow bottom sheet', () => {
    setWindowWidth(1000);
    render(<CodeCity {...props({ selectedFilePath: FIXTURE_PATHS.razor })} />);
    expect(screen.queryByTestId('city-diff-expand')).toBeNull();
  });
});

describe('CodeCity narrow window', () => {
  it('turns the rail into a bottom sheet that opens when a building is selected', () => {
    setWindowWidth(1000);
    const onSelectFile = vi.fn();
    const { rerender } = render(<CodeCity {...props({ onSelectFile })} />);
    expect(screen.queryByTestId('city-sheet')).toBeNull();
    expect(screen.queryByTestId('city-rail')).toBeNull();
    rerender(<CodeCity {...props({ onSelectFile, selectedFilePath: FIXTURE_PATHS.razor })} />);
    const sheet = within(screen.getByTestId('city-sheet'));
    expect(sheet.getByTestId('city-inspector')).toBeTruthy();
    fireEvent.click(sheet.getByRole('button', { name: 'Close the inspector' }));
    expect(onSelectFile).toHaveBeenCalledWith(null);
  });

  it('keeps the rail beside the scene at 1200px and wider', () => {
    setWindowWidth(1200);
    render(<CodeCity {...props()} />);
    expect(screen.getByTestId('city-rail')).toBeTruthy();
    expect(screen.queryByTestId('city-sheet')).toBeNull();
  });
});

describe('module exports', () => {
  it('exports CodeCity by name and as default for React.lazy', async () => {
    const mod = await import('./index');
    expect(mod.default).toBe(mod.CodeCity);
    expect(nameOf(FIXTURE_PATHS.razor)).toBe('FailedSyncFiles.razor');
  });
});
