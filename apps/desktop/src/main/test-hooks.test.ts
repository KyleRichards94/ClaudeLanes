import { describe, expect, it } from 'vitest';
import viteConfig from '../../electron.vite.config';
import { NO_TEST_HOOKS, readTestHooks, testHooksFor } from './test-hooks';

const env = {
  AGENT_LANES_SKIP_FIRST_RUN: '1',
  AGENT_LANES_CLAUDE_EXECUTABLE: 'C:/e2e/fake-claude-code.mjs',
  AGENT_LANES_DESIGN_TEST_ORIGIN: 'http://127.0.0.1:5123',
};

/** `__TEST_HOOKS__` as electron.vite.config.ts defines it for the main bundle in `mode`. */
function testHooksDefine(mode: string): unknown {
  const resolve = viteConfig as unknown as (env: { command: 'build' | 'serve'; mode: string }) => { main: { define: Record<string, unknown> } };
  return resolve({ command: 'build', mode }).main.define['__TEST_HOOKS__'];
}

describe('test hooks (AL-222)', () => {
  it('reads the e2e switches from the environment', () => {
    expect(readTestHooks(env)).toEqual({ skipFirstRun: true, claudeExecutable: 'C:/e2e/fake-claude-code.mjs', designTestOrigin: 'http://127.0.0.1:5123' });
    expect(readTestHooks({ AGENT_LANES_SKIP_FIRST_RUN: 'true', AGENT_LANES_CLAUDE_EXECUTABLE: ' ' })).toEqual(NO_TEST_HOOKS);
  });

  it('never uses them in the installed app', () => {
    expect(testHooksFor({ isPackaged: false, env })).toEqual(readTestHooks(env));
    expect(testHooksFor({ isPackaged: true, env })).toBe(NO_TEST_HOOKS);
  });

  it('builds them into pnpm build and e2e, and leaves them out of the release build pnpm package makes', () => {
    expect(testHooksDefine('production')).toBe('true');
    expect(testHooksDefine('gallery')).toBe('true');
    expect(testHooksDefine('release')).toBe('false');
  });
});
