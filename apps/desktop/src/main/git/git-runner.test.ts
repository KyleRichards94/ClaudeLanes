import { mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GitError, gitErrorToErr, type GitErrorCode } from './git-error';
import { createGitRunner } from './git-runner';
import { createTempRepo, isolatedGitEnv, type TempRepo } from './testing';

// Every git call is a process spawn (slow on Windows with antivirus), so these tests get more time.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let repo: TempRepo;

beforeAll(async () => {
  repo = await createTempRepo();
});

afterAll(async () => {
  await repo?.cleanup();
});

async function rejection(promise: Promise<unknown>): Promise<GitError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(GitError);
    return error as GitError;
  }
  throw new Error('expected the git call to fail');
}

async function expectCode(promise: Promise<unknown>, code: GitErrorCode): Promise<GitError> {
  const error = await rejection(promise);
  expect(error.code).toBe(code);
  return error;
}

async function localBranches(): Promise<string[]> {
  const out = await repo.exec(['for-each-ref', '--format=%(refname:short)', 'refs/heads/']);
  return out.split('\n').filter(Boolean).sort();
}

/** Files a successful shell injection in these tests would have created. */
async function strayFiles(): Promise<string[]> {
  const names = [...(await readdir(repo.dir)), ...(await readdir(repo.root))];
  return names.filter((name) => /pwned|injected/i.test(name));
}

/** Branch lifecycle: create, list exactly, switch to each, then back to main. No stray files, clean tree. */
async function expectBranchesRoundTrip(target: TempRepo, names: readonly string[]): Promise<void> {
  for (const name of names) {
    await target.git(['branch', name], { cwd: target.dir });
  }
  const listed = (await target.exec(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'])).split('\n');
  expect(listed.sort()).toEqual([...names, 'main'].sort());

  for (const name of names) {
    await target.git(['switch', '--quiet', name], { cwd: target.dir });
    expect(await target.exec(['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(name);
  }
  await target.git(['switch', '--quiet', 'main'], { cwd: target.dir });
  expect(await target.exec(['status', '--porcelain'])).toBe('');
}

describe('git runner: arguments reach git verbatim (no shell)', () => {
  // Valid ref names (git forbids spaces, not quotes) full of shell syntax for sh, cmd and PowerShell.
  const quotedBranches = [`feat/it's-'single'`, `o'brien's-fix`];
  const shellBranches = ['x;echo-injected', '$(touch${IFS}pwned)', '`touch${IFS}pwned`', '%PATH%&echo-pwned', '$HOME&&a;b'];
  // `"`, `|`, `<`, `>` are valid in ref names but not in Windows file names, so loose refs can't hold them there.
  const doubleQuotedBranches = [`feat/"double"-'single'`, `"wrapped"`, 'x;echo>pwned.txt|more', 'ends-with-quote"'];

  it('creates, lists and checks out branch names with single quotes and shell metacharacters exactly as given', async () => {
    await expectBranchesRoundTrip(repo, [...quotedBranches, ...shellBranches]);
    expect(await strayFiles()).toEqual([]);
  });

  it('does the same for branch names with double quotes (reftable storage, Git 2.45+)', async (context) => {
    const { stdout } = await repo.git(['--version'], { cwd: repo.dir });
    const [, major = 0, minor = 0] = /(\d+)\.(\d+)/.exec(stdout)?.map(Number) ?? [];
    if (major < 2 || (major === 2 && minor < 45)) context.skip();

    const reftable = await createTempRepo({ withOrigin: false, refFormat: 'reftable' });
    try {
      await expectBranchesRoundTrip(reftable, doubleQuotedBranches);
      const names = [...(await readdir(reftable.dir)), ...(await readdir(reftable.root))];
      expect(names.filter((name) => /pwned/.test(name))).toEqual([]);
    } finally {
      await reftable.cleanup();
    }
  });

  it('hands double-quoted names to git unchanged on any ref storage', async () => {
    for (const name of doubleQuotedBranches) {
      const { stdout } = await repo.git(['check-ref-format', '--branch', name], { cwd: repo.dir });
      expect(stdout.trim()).toBe(name);
    }
  });

  it('passes a branch name with spaces as one argument, which git itself refuses', async () => {
    const before = await localBranches();

    for (const name of ['two words', 'feature/has space; touch pwned', '"quoted" name', "x' && echo pwned > pwned.txt '"]) {
      const error = await expectCode(repo.git(['branch', name], { cwd: repo.dir }), 'COMMAND_FAILED');
      expect(error.exitCode).toBe(128);
      // git received the whole name as a single argument and named it in its error.
      expect(error.stderr).toContain('not a valid branch name');
      expect(error.args).toEqual(['branch', name]);
      expect(error.message).toContain(JSON.stringify(name));
    }

    expect(await localBranches()).toEqual(before);
    expect(await strayFiles()).toEqual([]);
  });

  it('round-trips a commit message with quotes, backslashes, newlines and shell syntax', async () => {
    // Backslashes before quotes and at the end are where Windows command-line quoting usually goes wrong.
    const message = `He said "ship it" & it's done; $(whoami) %USERNAME% \`id\` | more\n\nC:\\temp\\ "a\\"b" ends with \\`;
    await repo.git(['commit', '--quiet', '--allow-empty', '-m', message], { cwd: repo.dir });

    const { stdout } = await repo.git(['log', '-1', '--format=%B'], { cwd: repo.dir });
    expect(stdout.replace(/\n+$/, '')).toBe(message);
    expect(await strayFiles()).toEqual([]);
  });

  it('never leaves git waiting on stdin', async () => {
    const { stdout } = await repo.git(['hash-object', '--stdin'], { cwd: repo.dir, timeoutMs: 10_000 });
    expect(stdout.trim()).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  });
});

describe('git runner: typed errors', () => {
  it('reports a folder outside any repository as NOT_A_REPO', async () => {
    const outside = join(repo.root, 'not-a-repo');
    await mkdir(outside, { recursive: true });
    const error = await expectCode(repo.git(['status'], { cwd: outside }), 'NOT_A_REPO');
    expect(error.exitCode).toBe(128);
    expect(error.message).toMatch(/^git status failed \(exit 128\): fatal: not a git repository/);
  });

  it('reports a missing working folder as CWD_NOT_FOUND, not as missing git', async () => {
    await expectCode(repo.git(['status'], { cwd: join(repo.root, 'does-not-exist') }), 'CWD_NOT_FOUND');
  });

  it('reports a missing executable as GIT_NOT_FOUND', async () => {
    const git = createGitRunner({ gitPath: 'agent-lanes-no-such-git-binary' });
    const error = await expectCode(git(['--version'], { cwd: repo.dir }), 'GIT_NOT_FOUND');
    expect(error.message).toContain('2.38');
  });

  it('refuses relative folders and NUL bytes before starting git', async () => {
    await expectCode(repo.git(['status'], { cwd: 'relative/path' }), 'INVALID_ARGUMENT');
    await expectCode(repo.git(['status'], { cwd: '' }), 'INVALID_ARGUMENT');
    await expectCode(repo.git(['branch', 'bad\0name'], { cwd: repo.dir }), 'INVALID_ARGUMENT');
  });

  it('reports other non-zero exits as COMMAND_FAILED with the exit code and stderr', async () => {
    const error = await expectCode(
      repo.git(['rev-parse', '--verify', '--end-of-options', 'no-such-branch'], { cwd: repo.dir }),
      'COMMAND_FAILED',
    );
    expect(error.exitCode).toBe(128);
    expect(error.stderr).toContain('Needed a single revision');
    expect(error.message).toContain('fatal: Needed a single revision');
  });

  it('treats allowed exit codes as success', async () => {
    await repo.write('README.md', '# changed\n');
    const changed = await repo.git(['diff', '--quiet'], { cwd: repo.dir, allowedExitCodes: [1] });
    expect(changed.exitCode).toBe(1);
    await repo.exec(['checkout', '--', 'README.md']);
    const clean = await repo.git(['diff', '--quiet'], { cwd: repo.dir, allowedExitCodes: [1] });
    expect(clean.exitCode).toBe(0);
  });

  it('turns a GitError into a contract Err without throwing', async () => {
    const error = await rejection(repo.git(['status'], { cwd: join(repo.root, 'nowhere') }));
    expect(gitErrorToErr(error)).toEqual({
      ok: false,
      code: 'INTERNAL',
      message: error.message,
      details: { gitCode: 'CWD_NOT_FOUND', exitCode: null },
    });
    expect(gitErrorToErr(new Error('boom https://me:tok@example.com/x'))).toEqual({
      ok: false,
      code: 'INTERNAL',
      message: 'boom https://***@example.com/x',
    });
  });
});

describe('git runner: credentials never appear in errors', () => {
  const token = 'fakepat0000test1111never2222real';

  it('redacts URL user-info and Authorization headers from the message, args and stderr', async () => {
    const url = `https://agent:${token}@dev.azure.invalid/org/_git/repo`;
    const byUrl = await rejection(repo.git(['rev-parse', '--verify', '--end-of-options', url], { cwd: repo.dir }));
    const byHeader = await rejection(
      repo.git(['-c', `http.extraHeader=Authorization: Bearer ${token}`, 'rev-parse', '--verify', '--end-of-options', 'nope'], {
        cwd: repo.dir,
      }),
    );

    for (const error of [byUrl, byHeader]) {
      expect(error.message).not.toContain(token);
      expect(error.stderr).not.toContain(token);
      expect(error.args.join(' ')).not.toContain(token);
      expect(JSON.stringify(gitErrorToErr(error))).not.toContain(token);
      // Node's exec error repeats the raw command line, so it is never chained as the cause.
      expect(error.cause).toBeUndefined();
      expect(String(error.stack)).not.toContain(token);
    }
    expect(byUrl.message).toContain('https://***@dev.azure.invalid/org/_git/repo');
    expect(byHeader.args).toContain('http.extraHeader=***');
  });
});

describe('git runner: inherited environment', () => {
  const saved = process.env['GIT_DIR'];

  afterEach(() => {
    if (saved === undefined) delete process.env['GIT_DIR'];
    else process.env['GIT_DIR'] = saved;
  });

  it('ignores a GIT_DIR inherited from a parent git hook and runs against cwd', async () => {
    process.env['GIT_DIR'] = join(repo.root, 'origin.git');
    expect(await repo.exec(['rev-parse', '--show-toplevel'])).toBe(repo.dir.replaceAll('\\', '/'));
  });
});

describe('git runner: timeouts, cancellation and output limits', () => {
  // Node stands in for a git process that hangs or floods stdout.
  const fake = createGitRunner({ gitPath: process.execPath, env: isolatedGitEnv(tmpdir()) });
  const hang = ['-e', 'setInterval(() => {}, 1000)'];

  it('kills a command that runs past its timeout', async () => {
    const started = Date.now();
    const error = await expectCode(fake(hang, { cwd: tmpdir(), timeoutMs: 300 }), 'TIMEOUT');
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(error.message).toContain('did not finish within 300 ms');
  });

  it('kills a command when its AbortSignal fires, and refuses an already-aborted signal', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await expectCode(fake(hang, { cwd: tmpdir(), signal: controller.signal, timeoutMs: 20_000 }), 'ABORTED');
    await expectCode(fake(['-e', ''], { cwd: tmpdir(), signal: AbortSignal.abort() }), 'ABORTED');
  });

  it('stops a command that prints more than the output limit', async () => {
    await expectCode(
      fake(['-e', 'process.stdout.write("x".repeat(64 * 1024))'], { cwd: tmpdir(), maxOutputBytes: 1024 }),
      'OUTPUT_TOO_LARGE',
    );
  });
});
