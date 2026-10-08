import { describe, expect, it } from 'vitest';
import { createQuitConfirmation, quitQuestion } from './quit-confirmation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('quit confirmation (AL-213)', () => {
  it('lets the quit through without asking when no agent is mid-turn', () => {
    const asked: string[][] = [];
    const guard = createQuitConfirmation({ midTurn: () => [], confirm: async (ids) => (asked.push([...ids]), true) });
    let proceeded = 0;
    expect(guard.hold(() => proceeded++)).toBe(false);
    expect(asked).toEqual([]);
    expect(proceeded).toBe(0);
  });

  it('holds the quit while agents are mid-turn and quits once the user agrees', async () => {
    const answer = deferred<boolean>();
    const asked: string[][] = [];
    const guard = createQuitConfirmation({ midTurn: () => ['71273', '71274'], confirm: (ids) => (asked.push([...ids]), answer.promise) });
    let proceeded = 0;

    expect(guard.hold(() => proceeded++)).toBe(true);
    // A second close while the question is open asks nothing more.
    expect(guard.hold(() => proceeded++)).toBe(true);
    expect(asked).toEqual([['71273', '71274']]);

    answer.resolve(true);
    await flush();
    expect(proceeded).toBe(1);
    // The quit that follows is let through.
    expect(guard.hold(() => proceeded++)).toBe(false);
  });

  it('keeps the app open when the user cancels, and asks again on the next quit', async () => {
    let answer = deferred<boolean>();
    let asked = 0;
    const guard = createQuitConfirmation({ midTurn: () => ['71273'], confirm: () => (asked++, answer.promise) });
    let proceeded = 0;

    expect(guard.hold(() => proceeded++)).toBe(true);
    answer.resolve(false);
    await flush();
    expect(proceeded).toBe(0);

    answer = deferred<boolean>();
    expect(guard.hold(() => proceeded++)).toBe(true);
    expect(asked).toBe(2);
    // A question that fails to show counts as Cancel.
    answer.reject(new Error('no window'));
    await flush();
    expect(proceeded).toBe(0);
  });

  it('says how many agents and which tickets', () => {
    expect(quitQuestion(['71273']).message).toBe('An agent is mid-turn (#71273).');
    expect(quitQuestion(['71273', '71274']).message).toBe('2 agents are mid-turn (#71273, #71274).');
    expect(quitQuestion(['71273']).detail).toContain('Quitting stops them now');
  });
});
