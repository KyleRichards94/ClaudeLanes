import * as contracts from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { allowedLanes, dragLock } from '../index';

describe('drop-rules re-export (AL-230)', () => {
  it('is the contracts code itself, so renderer and main process agree', () => {
    expect(allowedLanes).toBe(contracts.allowedLanes);
    expect(dragLock).toBe(contracts.dragLock);
  });

  it('lights up Code review for any open PR', () => {
    const card = { kind: 'pull-request', id: 10598, author: { displayName: 'TY', id: 'ty' }, unresolvedThreads: 4, sourceBranch: 'b' } as const;
    expect(Object.keys(allowedLanes(card, { id: 'kr' }))).toEqual(['code-review']);
  });
});
