import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeConnections,
  connectionKindOf,
  endBlockingConnections,
  getConnectionsModal,
  openConnections,
  resetConnectionsModal,
  showConnectionsTab,
} from './connections-modal';

describe('connections modal state (AL-046)', () => {
  beforeEach(() => resetConnectionsModal());

  it('opens on Azure DevOps, or on the tab of the row a Reconnect names', () => {
    openConnections();
    expect(getConnectionsModal()).toMatchObject({ open: true, blocking: false, tab: 'ado', target: null, request: 1 });

    openConnections({ connectionId: 'claude' });
    expect(getConnectionsModal()).toMatchObject({ tab: 'claude', target: 'claude', request: 2 });
    openConnections({ connectionId: 'mcp:github' });
    expect(getConnectionsModal()).toMatchObject({ tab: 'mcp', target: 'mcp:github' });

    showConnectionsTab('ado');
    closeConnections();
    expect(getConnectionsModal()).toMatchObject({ open: false, target: null });
  });

  it('stays open while blocking, until first run ends it', () => {
    openConnections({ blocking: true });
    closeConnections();
    // A Reconnect meanwhile keeps it blocking.
    openConnections({ connectionId: 'ado:contoso' });
    expect(getConnectionsModal()).toMatchObject({ open: true, blocking: true, target: 'ado:contoso' });

    endBlockingConnections();
    expect(getConnectionsModal()).toMatchObject({ open: false, blocking: false });
  });

  it('names the kind of a connection id', () => {
    expect(connectionKindOf('ado:contoso')).toBe('ado');
    expect(connectionKindOf('claude')).toBe('claude');
    expect(connectionKindOf('mcp:github')).toBe('mcp');
  });
});
