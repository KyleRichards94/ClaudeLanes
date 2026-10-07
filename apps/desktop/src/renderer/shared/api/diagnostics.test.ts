import { RENDERER_ERROR_LIMITS, RendererErrorReportSchema } from '@agent-lanes/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeBridge } from '@/shared/testing';
import { copyDiagnostics, reportError, toRendererErrorReport } from './diagnostics';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toRendererErrorReport', () => {
  it('describes an Error with its name, message and stack', () => {
    const error = new TypeError('x is undefined');
    expect(toRendererErrorReport('boundary', error, { boundary: 'app', componentStack: '\n    at Card' })).toEqual({
      source: 'boundary',
      boundary: 'app',
      name: 'TypeError',
      message: 'x is undefined',
      stack: error.stack,
      componentStack: '\n    at Card',
    });
  });

  it.each([
    ['a string', 'plain failure', { source: 'promise', message: 'plain failure' }],
    ['an error-like object', { name: 'AbortError', message: 'aborted' }, { source: 'promise', name: 'AbortError', message: 'aborted' }],
    ['another value', { code: 42 }, { source: 'promise', message: '{"code":42}' }],
    ['undefined', undefined, { source: 'promise', message: 'undefined' }],
  ])('describes %s', (_label, value, expected) => {
    expect(toRendererErrorReport('promise', value)).toEqual(expected);
  });

  it('cuts every field to the contract limits, so a huge error is still logged', () => {
    const error = new Error('m'.repeat(10_000));
    error.stack = 's'.repeat(50_000);
    const report = toRendererErrorReport('window', error, { boundary: 'b'.repeat(500), componentStack: 'c'.repeat(50_000) });

    expect(RendererErrorReportSchema.safeParse(report).success).toBe(true);
    expect(report.message).toHaveLength(RENDERER_ERROR_LIMITS.message);
    expect(report.message.endsWith('…')).toBe(true);
  });
});

describe('reportError', () => {
  it('sends the report to app:logError', async () => {
    const bridge = installFakeBridge({ 'app:logError': { ok: true, data: null } });
    await reportError('window', new Error('boom'));
    expect(bridge.invoke).toHaveBeenCalledWith('app:logError', expect.objectContaining({ source: 'window', name: 'Error', message: 'boom' }));
  });

  it('never rejects, whatever the main process says', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installFakeBridge({ 'app:logError': { ok: false, code: 'VALIDATION', message: 'too big' } });
    await expect(reportError('window', new Error('boom'))).resolves.toBeUndefined();

    const bridge = installFakeBridge();
    vi.mocked(bridge.invoke).mockRejectedValueOnce(new Error('IPC closed'));
    await expect(reportError('window', new Error('boom'))).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('copyDiagnostics', () => {
  it('asks main to copy and returns what it says', async () => {
    const bridge = installFakeBridge({ 'app:copyDiagnostics': { ok: true, data: { characters: 1234 } } });
    await expect(copyDiagnostics()).resolves.toEqual({ ok: true, data: { characters: 1234 } });
    expect(bridge.invoke).toHaveBeenCalledWith('app:copyDiagnostics', undefined);
  });

  it('turns a broken bridge into an INTERNAL result', async () => {
    const bridge = installFakeBridge();
    vi.mocked(bridge.invoke).mockRejectedValueOnce(new Error('IPC closed'));
    await expect(copyDiagnostics()).resolves.toEqual({ ok: false, code: 'INTERNAL', message: 'IPC closed' });
  });
});
