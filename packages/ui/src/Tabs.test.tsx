import { useId, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { color, minTarget, radius, selection, tone } from '@agent-lanes/tokens';
import { Text } from './Text';
import { TabPanel, Tabs, tabId, tabPanelId, type TabItem, type TabsProps } from './Tabs';

/** jsdom reports computed colours as rgb(); tokens are #RRGGBB. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

type DrillTab = 'output' | 'diff' | 'build-log' | 'ado' | 'design';

/** The drill-in's tab bar (artboard 3). */
const drillIn: readonly TabItem<DrillTab>[] = [
  { value: 'output', label: 'Output' },
  { value: 'diff', label: 'Diff' },
  { value: 'build-log', label: 'Build log' },
  { value: 'ado', label: 'ADO' },
  { value: 'design', label: 'Claude Design', opensElsewhere: true },
];

type ConnectionTab = 'ado' | 'claude' | 'mcp';

/** The Connections modal's tabs (artboard 5): Azure DevOps needs attention, the others are connected. */
const connections: readonly TabItem<ConnectionTab>[] = [
  { value: 'ado', label: 'Azure DevOps', status: { tone: 'attention', label: 'Needs attention' } },
  { value: 'claude', label: 'Claude', status: { tone: 'ok', label: 'Connected' } },
  { value: 'mcp', label: 'MCP servers', status: { tone: 'ok', label: 'Connected' } },
];

type HarnessProps<T extends string> = Omit<TabsProps<T>, 'value' | 'onChange'> & {
  initial: T;
  onChange?: (value: T) => void;
};

/** Holds the selection the way a screen would, so key presses can be followed across renders. */
function Harness<T extends string>({ initial, onChange, ...props }: HarnessProps<T>) {
  const [value, setValue] = useState(initial);
  return (
    <Tabs
      {...props}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

const tab = (name: string | RegExp) => screen.getByRole('tab', { name });

function selected(): string[] {
  return screen
    .getAllByRole('tab')
    .filter((element) => element.getAttribute('aria-selected') === 'true')
    .map((element) => element.textContent ?? '');
}

/** The visible pill inside a tab's 44 px target. */
function thumbOf(element: HTMLElement): HTMLElement {
  const thumb = element.firstElementChild;
  if (!(thumb instanceof HTMLElement)) throw new Error('tab has no thumb');
  return thumb;
}

describe('Tabs', () => {
  describe('semantics', () => {
    it('is a named tablist of tabs, one selected', () => {
      render(<Tabs label="Ticket views" tabs={drillIn} value="output" onChange={() => {}} />);
      expect(screen.getByRole('tablist', { name: 'Ticket views' })).toBeTruthy();
      expect(screen.getAllByRole('tab')).toHaveLength(5);
      expect(tab('Output').getAttribute('aria-selected')).toBe('true');
      expect(selected()).toEqual(['Output']);
    });

    it('gives the list a single Tab stop, on the selected tab', () => {
      render(<Tabs label="Ticket views" tabs={drillIn} value="build-log" onChange={() => {}} />);
      expect(tab('Build log').getAttribute('tabindex')).toBe('0');
      for (const name of ['Output', 'Diff', 'ADO', 'Claude Design']) {
        expect(tab(name).getAttribute('tabindex')).toBe('-1');
      }
    });

    it('links the selected tab and its panel through idPrefix', () => {
      function Linked() {
        const id = useId();
        const [value, setValue] = useState<ConnectionTab>('ado');
        return (
          <>
            <Tabs label="Connection type" idPrefix={id} tabs={connections} value={value} onChange={setValue} />
            <TabPanel idPrefix={id} value={value}>
              <Text>{`${value} settings`}</Text>
            </TabPanel>
          </>
        );
      }
      render(<Linked />);
      const panel = screen.getByRole('tabpanel');
      const ado = tab(/^Azure DevOps/);
      expect(ado.getAttribute('aria-controls')).toBe(panel.id);
      expect(panel.getAttribute('aria-labelledby')).toBe(ado.id);
      expect(screen.getByRole('tabpanel', { name: 'Azure DevOps, Needs attention' })).toBe(panel);
      // Unselected tabs don't point at panels that aren't rendered.
      expect(tab(/^Claude/).hasAttribute('aria-controls')).toBe(false);
    });

    it('builds tab and panel ids from the prefix', () => {
      expect(tabId('conn', 'mcp')).toBe('conn-tab-mcp');
      expect(tabPanelId('conn', 'mcp')).toBe('conn-panel-mcp');
    });

    it('sets no ids without idPrefix', () => {
      render(<Tabs label="Ticket views" tabs={drillIn} value="output" onChange={() => {}} />);
      expect(tab('Output').hasAttribute('id')).toBe(false);
      expect(tab('Output').hasAttribute('aria-controls')).toBe(false);
    });
  });

  describe('keyboard', () => {
    it('Tab reaches the selected tab', async () => {
      const user = userEvent.setup();
      render(<Tabs label="Ticket views" tabs={drillIn} value="diff" onChange={() => {}} />);
      await user.tab();
      expect(document.activeElement).toBe(tab('Diff'));
      await user.tab();
      expect(document.body.contains(document.activeElement) && document.activeElement?.getAttribute('role')).not.toBe('tab');
    });

    it('Left and Right move focus and selection, wrapping at the ends', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<Harness label="Ticket views" tabs={drillIn.slice(0, 4)} initial="output" onChange={onChange} />);
      await user.tab();

      await user.keyboard('{ArrowRight}');
      expect(document.activeElement).toBe(tab('Diff'));
      expect(selected()).toEqual(['Diff']);

      await user.keyboard('{ArrowLeft}{ArrowLeft}');
      expect(document.activeElement).toBe(tab('ADO'));
      expect(selected()).toEqual(['ADO']);

      await user.keyboard('{ArrowRight}');
      expect(selected()).toEqual(['Output']);
      expect(onChange.mock.calls.map(([value]) => value)).toEqual(['diff', 'output', 'ado', 'output']);
      // The Tab stop follows the selection.
      expect(tab('Output').getAttribute('tabindex')).toBe('0');
    });

    it('Home and End jump to the first and last tab', async () => {
      const user = userEvent.setup();
      render(<Harness label="Ticket views" tabs={drillIn.slice(0, 4)} initial="diff" />);
      await user.tab();
      await user.keyboard('{End}');
      expect(selected()).toEqual(['ADO']);
      await user.keyboard('{Home}');
      expect(selected()).toEqual(['Output']);
      expect(document.activeElement).toBe(tab('Output'));
    });

    it('skips disabled tabs', async () => {
      const user = userEvent.setup();
      const tabs = drillIn.slice(0, 4).map((item) => (item.value === 'diff' ? { ...item, disabled: true } : item));
      render(<Harness label="Ticket views" tabs={tabs} initial="output" />);
      await user.tab();
      await user.keyboard('{ArrowRight}');
      expect(selected()).toEqual(['Build log']);
      expect(tab('Diff').getAttribute('aria-disabled')).toBe('true');
    });

    it('arrows onto a tab that opens elsewhere without opening it; Enter or Space opens it', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<Harness label="Ticket views" tabs={drillIn} initial="ado" onChange={onChange} />);
      await user.tab();

      await user.keyboard('{ArrowRight}');
      expect(document.activeElement).toBe(tab('Claude Design'));
      expect(onChange).not.toHaveBeenCalled();
      expect(selected()).toEqual(['ADO']);

      await user.keyboard('{Enter}');
      expect(onChange).toHaveBeenLastCalledWith('design');
    });

    it.each([
      ['Space', ' '],
      ['Enter', '{Enter}'],
    ])('%s selects the focused tab', async (_key, keys) => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<Tabs label="Ticket views" tabs={drillIn} value="ado" onChange={onChange} />);
      await user.tab();
      await user.keyboard('{ArrowRight}');
      expect(onChange).not.toHaveBeenCalled();
      await user.keyboard(keys);
      expect(onChange).toHaveBeenCalledWith('design');
    });

    it('selects on click', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<Tabs label="Connection type" tabs={connections} value="ado" onChange={onChange} />);
      await user.click(tab(/^MCP servers/));
      expect(onChange).toHaveBeenCalledWith('mcp');
    });

    it('ignores clicks on a disabled tab and on the selected one', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const tabs = connections.map((item) => (item.value === 'mcp' ? { ...item, disabled: true } : item));
      render(<Tabs label="Connection type" tabs={tabs} value="ado" onChange={onChange} />);
      await user.click(tab(/^MCP servers/));
      await user.click(tab(/^Azure DevOps/));
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('looks (artboards 3 and 5)', () => {
    it('draws a grey track with the selected tab as a raised white thumb in ink', () => {
      render(<Tabs label="Ticket views" tabs={drillIn} value="output" onChange={() => {}} testID="tabs" />);
      const track = getComputedStyle(screen.getByTestId('tabs'));
      expect(track.backgroundColor).toBe(rgb(selection.track));
      expect(track.borderTopLeftRadius).toBe(`${radius.control}px`);

      const on = getComputedStyle(thumbOf(tab('Output')));
      expect(on.backgroundColor).toBe(rgb(color.surface));
      expect(on.boxShadow).toBe(selection.thumbShadow);
      expect(on.borderTopLeftRadius).toBe(`${radius.chip}px`);
      expect(getComputedStyle(screen.getByText('Output')).color).toBe(rgb(color.ink));
      expect(getComputedStyle(screen.getByText('Output')).fontWeight).toBe('700');

      const off = getComputedStyle(thumbOf(tab('Diff')));
      expect(['', 'transparent', 'rgba(0, 0, 0, 0)']).toContain(off.backgroundColor);
      expect(getComputedStyle(screen.getByText('Diff')).color).toBe(rgb(selection.label));
    });

    it('makes every tab a 44 px target', () => {
      render(<Tabs label="Ticket views" tabs={drillIn} value="output" onChange={() => {}} />);
      for (const element of screen.getAllByRole('tab')) {
        expect(getComputedStyle(element).minHeight).toBe(`${minTarget}px`);
      }
    });

    it('darkens an unselected label on hover', async () => {
      const user = userEvent.setup();
      render(<Tabs label="Ticket views" tabs={drillIn} value="output" onChange={() => {}} />);
      await user.hover(tab('Diff'));
      expect(getComputedStyle(screen.getByText('Diff')).color).toBe(rgb(color.ink));
    });

    it('draws the trailing ↗ on a tab that opens elsewhere, in the label colour and hidden from screen readers', () => {
      render(<Tabs label="Ticket views" tabs={drillIn} value="output" onChange={() => {}} />);
      const svg = tab('Claude Design').querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('stroke')).toBe(selection.label);
      expect(svg?.getAttribute('width')).toBe('14');
      expect(tab('Output').querySelector('svg')).toBeNull();
    });

    it('shows a status dot in the tone colour and says its word in the tab name', () => {
      render(<Tabs label="Connection type" tabs={connections} value="ado" onChange={() => {}} testID="conn" />);
      const ado = screen.getByTestId('conn-ado-dot');
      expect(ado.getAttribute('aria-hidden')).toBe('true');
      expect(getComputedStyle(ado).backgroundColor).toBe(rgb(tone.attention.dot));
      expect(getComputedStyle(ado).width).toBe('7px');
      expect(getComputedStyle(screen.getByTestId('conn-claude-dot')).backgroundColor).toBe(rgb(tone.ok.dot));

      expect(tab('Azure DevOps, Needs attention')).toBeTruthy();
      expect(tab('Claude, Connected')).toBeTruthy();
      expect(tab('MCP servers, Connected')).toBeTruthy();
    });

    it('lets accessibilityLabel replace the spoken name', () => {
      const tabs: TabItem<'log'>[] = [{ value: 'log', label: 'Build log', accessibilityLabel: 'Build log, 3 errors' }];
      render(<Tabs label="Ticket views" tabs={tabs} value="log" onChange={() => {}} />);
      expect(tab('Build log, 3 errors')).toBeTruthy();
    });

    it('fades a disabled tab', () => {
      const tabs = drillIn.map((item) => (item.value === 'diff' ? { ...item, disabled: true } : item));
      render(<Tabs label="Ticket views" tabs={tabs} value="output" onChange={() => {}} />);
      expect(getComputedStyle(tab('Diff')).opacity).toBe(String(selection.disabledOpacity));
    });
  });
});
