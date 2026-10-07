/**
 * Lint probes (AL-008): prove the lint gate still fails the build on the violations it exists for
 * (design §5, "Dependency direction is enforced in CI").
 *
 * Every probe is a deliberately broken file that must make the linter exit non-zero with the expected
 * message; every control is a legal file that must pass, so a probe can't "fail" for an unrelated
 * reason. Nothing is written to src/: ESLint lints each probe from stdin under a path inside the app,
 * and Steiger runs on a throwaway FSD tree in the OS temp folder with this repo's steiger.config.mjs.
 *
 * Run with `pnpm lint:probes`; CI runs it after `pnpm lint`.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const renderer = 'apps/desktop/src/renderer';

/** Absolute path of a dependency's CLI, read from its package.json (node-linker=hoisted, D3). */
function cliOf(pkg) {
  const dir = join(root, 'node_modules', pkg);
  const { bin } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  return join(dir, typeof bin === 'string' ? bin : bin[pkg]);
}

function run(cli, args, input) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    input,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** ESLint `no-restricted-imports` rules from eslint.config.mjs, one probe per rule family. */
const eslintCases = [
  {
    name: 'ESLint: shared imports a page (layer direction)',
    file: `${renderer}/shared/lib/lint-probe.ts`,
    code: "export * from '@/pages/board';\n",
    expect: 'shared may not import from pages',
  },
  {
    name: 'ESLint: a feature imports another feature (same-layer slices)',
    file: `${renderer}/features/lint-probe-a/index.ts`,
    code: "export * from '@/features/lint-probe-b';\n",
    expect: 'features may not import from features',
  },
  {
    name: "ESLint: deep import past a slice's index.ts",
    file: `${renderer}/app/lint-probe.ts`,
    code: "export * from '@/pages/board/ui/board-page';\n",
    expect: 'Import a slice through its public API',
  },
  {
    name: 'ESLint: electron imported in the renderer',
    file: `${renderer}/shared/lib/lint-probe.ts`,
    code: "export * from 'electron';\n",
    expect: 'Main-process only',
  },
  {
    name: 'ESLint: node:fs imported in the renderer',
    file: `${renderer}/entities/lint-probe/index.ts`,
    code: "export * from 'node:fs';\n",
    expect: 'The renderer has no Node APIs',
  },
  {
    name: 'ESLint: UI code imported in the main process',
    file: 'apps/desktop/src/main/lint-probe.ts',
    code: "export * from 'react';\n",
    expect: 'UI code belongs in the renderer',
  },
  {
    name: 'ESLint control: a page imports shared (allowed)',
    file: `${renderer}/pages/board/lint-probe.ts`,
    code: "export * from '@/shared/api';\n",
    expect: null,
  },
];

/** Steiger FSD trees: `files` maps a path under the FSD root to its source. */
const steigerCases = [
  {
    name: 'Steiger: shared imports a page (fsd/forbidden-imports)',
    files: {
      'pages/home/index.ts': "export { Home } from './ui/home';\n",
      'pages/home/ui/home.ts': "import { helper } from '../../../shared/lib';\n\nexport const Home = helper;\n",
      'shared/lib/index.ts': "import { Home } from '../../pages/home';\n\nexport const helper = () => Home;\n",
    },
    expect: 'fsd/forbidden-imports',
  },
  {
    name: 'Steiger control: a page imports shared (allowed)',
    files: {
      'pages/home/index.ts': "export { Home } from './ui/home';\n",
      'pages/home/ui/home.ts': "import { helper } from '../../../shared/lib';\n\nexport const Home = helper;\n",
      'shared/lib/index.ts': "export const helper = () => 'home';\n",
    },
    expect: null,
  },
];

function lintWithEslint({ file, code }) {
  return run(cliOf('eslint'), ['--stdin', '--stdin-filename', file], code);
}

function lintWithSteiger({ files }) {
  const scratch = mkdtempSync(join(tmpdir(), 'agent-lanes-lint-probe-'));
  try {
    const fsdRoot = join(scratch, 'src');
    for (const [path, source] of Object.entries(files)) {
      const target = join(fsdRoot, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, source);
    }
    return run(cliOf('steiger'), [fsdRoot]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** A probe must exit non-zero for the expected reason; a control must exit 0. */
function check(testCase, { status, output }) {
  if (testCase.expect === null) {
    return status === 0 ? null : `expected exit 0, got ${status}`;
  }
  if (status === 0) return 'expected a non-zero exit, got 0 (the violation was not caught)';
  if (!output.includes(testCase.expect)) return `exited ${status} but the output lacks "${testCase.expect}"`;
  return null;
}

const failures = [];
const cases = [
  ...eslintCases.map((testCase) => [testCase, lintWithEslint]),
  ...steigerCases.map((testCase) => [testCase, lintWithSteiger]),
];

for (const [testCase, lint] of cases) {
  const result = lint(testCase);
  const problem = check(testCase, result);
  console.log(`${problem ? 'FAIL' : 'ok  '}  ${testCase.name}`);
  if (problem) failures.push({ name: testCase.name, problem, output: result.output.trim() });
}

if (failures.length > 0) {
  for (const { name, problem, output } of failures) {
    console.error(`\n${name}: ${problem}\n${output}`);
  }
  console.error(`\n${failures.length} of ${cases.length} lint probes failed: the lint gate no longer blocks these.`);
  process.exit(1);
}

console.log(`\nAll ${cases.length} lint probes behaved: violations fail lint, controls pass.`);
