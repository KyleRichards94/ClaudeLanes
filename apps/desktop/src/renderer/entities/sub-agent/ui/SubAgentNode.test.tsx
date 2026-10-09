import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SubagentNode as Node } from '@agent-lanes/contracts';
import { tokensLabel } from '../model/tree';
import { SubAgentList } from './SubAgentNode';

const node: Node = {
  id: 'toolu_a',
  taskId: 'task_1',
  parentId: null,
  name: 'explore',
  agentType: 'explore',
  description: 'Map the forms',
  model: null,
  effort: null,
  status: 'running',
  activity: 'Reading frmJobControl.vb',
  tokens: 12_400,
  branch: null,
  readOnly: true,
  startedAt: 1,
  endedAt: null,
};
const lead = { stage: 'implementing' as const, model: 'opus' as const, effort: 'xhigh' as const };

describe('SubAgentNode (AL-261)', () => {
  it('shows tokens, stops a running sub-agent, and opens its output on click', () => {
    const onSelect = vi.fn();
    const onStop = vi.fn();
    render(<SubAgentList items={[{ node, children: [] }]} lead={lead} actions={{ onSelect, onStop, stoppingId: null }} />);

    expect(screen.getByTestId('sub-agent-toolu_a-tokens').textContent).toBe(tokensLabel(12_400));
    fireEvent.click(screen.getByTestId('sub-agent-toolu_a-stop'));
    expect(onStop).toHaveBeenCalledWith(node);
    // Stop is its own control: it does not also open the output.
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'explore, Running' }));
    expect(onSelect).toHaveBeenCalledWith(node);
  });

  it('has no Stop for a finished sub-agent or one without a task, and is not a button without onSelect', () => {
    render(
      <SubAgentList
        items={[
          { node: { ...node, status: 'done', endedAt: 2 }, children: [] },
          { node: { ...node, id: 'toolu_b', taskId: null, status: 'queued', tokens: null }, children: [] },
        ]}
        lead={lead}
        actions={{ onStop: vi.fn() }}
      />,
    );
    expect(screen.queryByTestId('sub-agent-toolu_a-stop')).toBeNull();
    expect(screen.queryByTestId('sub-agent-toolu_b-stop')).toBeNull();
    expect(screen.queryByTestId('sub-agent-toolu_b-tokens')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
