/**
 * The test-only switches e2e uses to swap fakes in (AL-222, design §12): open on the board instead of
 * first run (AL-047), start a fake `claude` instead of the real binary (AL-044, D339), treat a
 * local fake site as claude.ai for Design canvases (AL-191, D247), and keep peer lanes on loopback
 * on its own ports, away from a real Agent Lanes on the same computer (AL-298).
 *
 * `main/index.ts` reads them only when the build has test hooks (`__TEST_HOOKS__`) and the app is
 * not installed (`app.isPackaged`). `pnpm package` builds with `--mode release`, where
 * `__TEST_HOOKS__` is false, so this module and the variable names are left out of the bundle.
 */
export interface TestHooks {
  /** `AGENT_LANES_SKIP_FIRST_RUN=1`: specs open straight on the board. */
  skipFirstRun: boolean;
  /** `AGENT_LANES_CLAUDE_EXECUTABLE`: the fake `claude` (e2e/fixtures/fake-claude-code.mjs). */
  claudeExecutable: string | undefined;
  /** `AGENT_LANES_DESIGN_TEST_ORIGIN`: the local stand-in for claude.ai's Design canvases. */
  designTestOrigin: string | undefined;
  /** `AGENT_LANES_PEER_TEST_PORTS=<ws>:<beacon>`: peer lanes on loopback only, on these ports unless the Peers connection says otherwise. */
  peerPorts: { port: number; beaconPort: number } | undefined;
}

/** What the installed app and a release build use: no fakes. */
export const NO_TEST_HOOKS: TestHooks = { skipFirstRun: false, claudeExecutable: undefined, designTestOrigin: undefined, peerPorts: undefined };

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

function ports(value: string | undefined): TestHooks['peerPorts'] {
  const match = /^(\d{1,5}):(\d{1,5})$/.exec(value?.trim() ?? '');
  if (!match) return undefined;
  const [port, beaconPort] = [Number(match[1]), Number(match[2])];
  return port <= 65_535 && beaconPort >= 1 && beaconPort <= 65_535 ? { port, beaconPort } : undefined;
}

export function readTestHooks(env: NodeJS.ProcessEnv): TestHooks {
  return {
    skipFirstRun: env['AGENT_LANES_SKIP_FIRST_RUN'] === '1',
    claudeExecutable: nonEmpty(env['AGENT_LANES_CLAUDE_EXECUTABLE']),
    designTestOrigin: nonEmpty(env['AGENT_LANES_DESIGN_TEST_ORIGIN']),
    peerPorts: ports(env['AGENT_LANES_PEER_TEST_PORTS']),
  };
}

/** The hooks a build that has them runs with: none in the installed app. */
export function testHooksFor(options: { isPackaged: boolean; env: NodeJS.ProcessEnv }): TestHooks {
  return options.isPackaged ? NO_TEST_HOOKS : readTestHooks(options.env);
}
