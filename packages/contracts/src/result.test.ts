import { describe, expect, it } from 'vitest';
import { err, isErrorCode, ok } from './result';
import { ResultEnvelopeSchema, invokeContracts } from './schemas';

describe('Result helpers', () => {
  it('wraps data in an ok result', () => {
    expect(ok(42)).toEqual({ ok: true, data: 42 });
  });

  it('omits details when none are given', () => {
    expect(err('GIT_DIRTY', 'Worktree has changes')).toEqual({
      ok: false,
      code: 'GIT_DIRTY',
      message: 'Worktree has changes',
    });
  });

  it('recognises only known error codes', () => {
    expect(isErrorCode('MERGE_CONFLICT')).toBe(true);
    expect(isErrorCode('NOPE')).toBe(false);
  });
});

describe('ResultEnvelopeSchema', () => {
  it('rejects an error with an unknown code', () => {
    expect(ResultEnvelopeSchema.safeParse({ ok: false, code: 'NOPE', message: 'x' }).success).toBe(false);
  });

  it('accepts an ok envelope', () => {
    expect(ResultEnvelopeSchema.safeParse({ ok: true, data: { a: 1 } }).success).toBe(true);
  });
});

describe('app:getInfo contract', () => {
  it('takes no request payload', () => {
    expect(invokeContracts['app:getInfo'].request.safeParse(undefined).success).toBe(true);
    expect(invokeContracts['app:getInfo'].request.safeParse({}).success).toBe(false);
  });
});
