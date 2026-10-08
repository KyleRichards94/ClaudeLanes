import { isFailingMcpState, type McpStatusSummary } from '@agent-lanes/contracts';
import { Pill } from '@agent-lanes/ui';
import { useMcpStatus } from '@/shared/api';
import { HoverHint } from './HoverHint';

/** What the pill says and how it is tinted for a summary (artboard 1: green "MCP online" with a dot). */
export function mcpPillView(summary: McpStatusSummary | undefined): { label: string; tone: 'ok' | 'attention' | 'neutral'; hint: string | null } {
  const failing = summary?.servers.filter((server) => isFailingMcpState(server.state)) ?? [];
  if (failing.length > 0) {
    return {
      label: `${failing.length} MCP failing`,
      tone: 'attention',
      hint: `Failing: ${failing.map((server) => (server.error ? `${server.name} (${server.error})` : server.name)).join(' · ')}`,
    };
  }
  if (!summary || summary.state === 'none') return { label: 'MCP idle', tone: 'neutral', hint: 'No agent session is running' };
  return { label: 'MCP online', tone: 'ok', hint: `Connected: ${summary.servers.map((server) => server.name).join(' · ')}` };
}

/**
 * The board header's MCP pill (AL-108, artboard 1): green "MCP online" while every MCP server of the
 * running sessions is connected; amber "N MCP failing" when one is not, naming them on hover.
 */
export function McpStatusPill() {
  const status = useMcpStatus();
  const view = mcpPillView(status.data);
  return (
    <HoverHint hint={view.hint}>
      <Pill
        size="md"
        tone={view.tone}
        dot={view.tone !== 'neutral'}
        label={view.label}
        testID="mcp-status-pill"
      />
    </HoverHint>
  );
}
