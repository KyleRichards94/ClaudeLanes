import { describe, expect, it } from 'vitest';
import { composerControls, isSendShortcut } from './composer';

describe('composerControls (AL-176)', () => {
  it('offers Pause while the agent works and Resume while paused', () => {
    expect(composerControls({ state: 'running', switching: false, held: 0 }).pause).toEqual({ label: 'Pause', icon: 'pause', disabled: false });
    expect(composerControls({ state: 'idle', switching: false, held: 0 }).pause.disabled).toBe(false);
    expect(composerControls({ state: 'paused', switching: false, held: 0 }).pause).toEqual({ label: 'Resume', icon: 'play', disabled: false });
    expect(composerControls({ state: 'starting', switching: false, held: 0 }).pause.disabled).toBe(true);
    expect(composerControls({ state: 'none', switching: false, held: 0 }).pause.disabled).toBe(true);
  });

  it('says how many messages wait for Resume', () => {
    expect(composerControls({ state: 'paused', switching: false, held: 0 }).note).toBe('Paused · messages you send now are delivered on Resume');
    expect(composerControls({ state: 'paused', switching: false, held: 1 }).note).toBe('Paused · 1 message queued, delivered on Resume');
    expect(composerControls({ state: 'paused', switching: false, held: 3 }).note).toBe('Paused · 3 messages queued, delivered on Resume');
    expect(composerControls({ state: 'running', switching: false, held: 0 }).note).toBeNull();
  });

  it('enables "Apply model now" only while a change waits on a live, unpaused session', () => {
    expect(composerControls({ state: 'running', switching: true, held: 0 }).applyModel.disabled).toBe(false);
    expect(composerControls({ state: 'running', switching: false, held: 0 }).applyModel.disabled).toBe(true);
    expect(composerControls({ state: 'paused', switching: true, held: 0 }).applyModel.disabled).toBe(true);
    expect(composerControls({ state: 'stopped', switching: true, held: 0 }).applyModel.disabled).toBe(true);
  });

  it('explains why a ticket without a live session cannot take messages', () => {
    expect(composerControls({ state: 'none', switching: false, held: 0 })).toMatchObject({ live: false, skillsDisabled: true, note: 'No agent session is running for this ticket.' });
    expect(composerControls({ state: 'lost', switching: false, held: 0 }).note).toMatch(/Reconnect/);
    expect(composerControls({ state: 'queued', switching: false, held: 0 }).note).toMatch(/free slot/);
  });
});

describe('isSendShortcut', () => {
  it('is Ctrl+Enter (or Cmd+Enter), not plain Enter or Enter while composing', () => {
    expect(isSendShortcut({ key: 'Enter', ctrlKey: true })).toBe(true);
    expect(isSendShortcut({ key: 'Enter', metaKey: true })).toBe(true);
    expect(isSendShortcut({ key: 'Enter' })).toBe(false);
    expect(isSendShortcut({ key: 'a', ctrlKey: true })).toBe(false);
    expect(isSendShortcut({ key: 'Enter', ctrlKey: true, isComposing: true })).toBe(false);
  });
});
