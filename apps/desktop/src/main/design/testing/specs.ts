import type { DesignSpec } from '@agent-lanes/contracts';

/** Design v`version` of ticket 71273 (artboard 4): JobControl · desktop and JobFilter · side panel. Test-only. */
export function fakeSpec(version: number, overrides: Partial<DesignSpec> = {}): DesignSpec {
  return {
    ticketId: '71273',
    version,
    shippedAt: 14 * 3_600_000 + version,
    approvedBy: 'Kyle',
    note: version === 1 ? '' : 'Tighter filter panel',
    canvasUrl: 'https://claude.ai/design/p/abc123',
    tokensFile: 'agent-lanes-tokens.css',
    artboards: [
      { id: 'JobControl.html', name: 'JobControl · desktop', width: 1440, height: 900, source: '<main>grid</main>' },
      { id: 'JobFilter.html', name: 'JobFilter · side panel', width: 420, height: 900, source: '<aside>filters</aside>' },
    ],
    supersedes: version > 1 ? version - 1 : null,
    reshipOf: null,
    ...overrides,
  };
}
