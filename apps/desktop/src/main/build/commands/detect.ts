import { open, readdir } from 'node:fs/promises';
import { join, posix } from 'node:path';
import type { DetectedCommands, RunTargetKind } from '@agent-lanes/contracts';
import { commandLine, pathArg } from './command-line';
import { classifyProject, rankRunProjects, type ProjectInfo } from './dotnet-project';
import { nodeCommands, packageManagerFromField, packageManagerFromLockfiles } from './node-package';
import { isProjectFile, isSolutionFile, parseSolution, type SolutionProject } from './solution';

/** Larger solution, project or package.json files are skipped rather than read. */
export const MAX_DETECT_FILE_BYTES = 4 * 1024 * 1024;
/** Project files read from one solution to find the one to run. */
const MAX_PROJECTS_READ = 400;
/** Top-level folders searched for a solution when the root has nothing to build. */
const MAX_SUBFOLDERS = 64;
/** Files read at once. */
const READ_CONCURRENCY = 16;
/** Build output, dependencies and tool folders, which never hold the repo's own solution. */
const SKIPPED_FOLDERS = new Set(['node_modules', 'bin', 'obj', 'packages', 'dist', 'out', 'build', 'target', 'vendor', 'artifacts', 'testresults']);

interface FolderListing {
  files: string[];
  folders: string[];
}

/** Sorts names the same on every machine: case-insensitively, then by exact characters. */
function compareNames(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x !== y) return x < y ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

async function listFolder(dir: string): Promise<FolderListing | null> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    const folders: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) folders.push(entry.name);
      else if (entry.isFile() || entry.isSymbolicLink()) files.push(entry.name);
    }
    return { files: files.sort(compareNames), folders: folders.sort(compareNames) };
  } catch {
    // Missing, not a folder, or not readable: nothing to detect.
    return null;
  }
}

/** A small text file's contents without a BOM, or null when it is missing, too large or unreadable. */
async function readText(path: string): Promise<string | null> {
  try {
    const handle = await open(path, 'r');
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size > MAX_DETECT_FILE_BYTES) return null;
      return (await handle.readFile({ encoding: 'utf8' })).replace(/^﻿/, '');
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

async function mapLimit<T, R>(items: readonly T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await map(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

interface ClassifiedProject extends SolutionProject {
  info: ProjectInfo;
}

/** Reads and classifies projects (paths relative to `dir`), keeping their order; unreadable ones are left out. */
async function classifyProjects(dir: string, projects: readonly SolutionProject[]): Promise<ClassifiedProject[]> {
  const read = await mapLimit(projects.slice(0, MAX_PROJECTS_READ), READ_CONCURRENCY, async (project) => {
    const xml = await readText(join(dir, project.path));
    return xml === null ? null : { ...project, info: classifyProject(project.name, xml) };
  });
  return read.filter((project): project is ClassifiedProject => project !== null);
}

type RunPart = Pick<DetectedCommands, 'run' | 'runTarget' | 'runKind'>;

const NO_RUN: RunPart = { run: null, runTarget: null, runKind: null };

/** `dotnet run --project <best runnable project>`, or no run command. */
function dotnetRun(ranked: readonly ClassifiedProject[]): RunPart {
  for (const project of ranked) {
    const run = commandLine(['dotnet', 'run', '--project', pathArg(project.path)]);
    if (run) return { run, runTarget: project.path, runKind: project.info.kind as RunTargetKind };
  }
  return NO_RUN;
}

interface ParsedSolution {
  path: string;
  projects: SolutionProject[];
}

/** The fullest solution first, `.sln` before `.slnx` (older SDKs cannot build it), shallower, then by name. */
function compareSolutions(a: ParsedSolution, b: ParsedSolution): number {
  const slnx = (solution: ParsedSolution) => (solution.path.toLowerCase().endsWith('.slnx') ? 1 : 0);
  const depth = (solution: ParsedSolution) => solution.path.split('/').length;
  return (
    b.projects.length - a.projects.length ||
    slnx(a) - slnx(b) ||
    depth(a) - depth(b) ||
    a.path.length - b.path.length ||
    compareNames(a.path, b.path)
  );
}

/** `dotnet build <solution> -c Debug` and the solution's runnable project. `paths` are relative to `dir`. */
async function fromSolutions(dir: string, paths: readonly string[]): Promise<DetectedCommands | null> {
  const parsed = await mapLimit(paths, READ_CONCURRENCY, async (path): Promise<ParsedSolution | null> => {
    const text = await readText(join(dir, path));
    return text === null ? null : { path, projects: parseSolution(path, text) };
  });
  const solutions = parsed.filter((solution): solution is ParsedSolution => solution !== null).sort(compareSolutions);

  for (const solution of solutions) {
    const build = commandLine(['dotnet', 'build', pathArg(solution.path), '-c', 'Debug']);
    if (!build) continue;
    // Project paths are relative to the solution; a ticket worktree holds only the repo's own files.
    const folder = posix.dirname(solution.path);
    const inRepo = solution.projects
      .map((project) => ({ ...project, path: posix.join(folder, project.path) }))
      .filter((project) => project.path !== '..' && !project.path.startsWith('../'));
    const ranked = rankRunProjects(await classifyProjects(dir, inRepo));
    return { toolchain: 'dotnet', manifest: solution.path, packageManager: null, build, ...dotnetRun(ranked) };
  }
  return null;
}

/** No solution: build a project file at the root, preferring one that can be run, and run the best runnable one. */
async function fromProjectFiles(dir: string, paths: readonly string[]): Promise<DetectedCommands | null> {
  if (paths.length === 0) return null;
  const projects = await classifyProjects(
    dir,
    paths.map((path) => ({ name: path.replace(/\.[^.]+$/, ''), path })),
  );
  const ranked = rankRunProjects(projects);
  const buildOrder = [...ranked, ...projects.filter((project) => !project.info.test), ...projects];

  for (const project of buildOrder) {
    const build = commandLine(['dotnet', 'build', pathArg(project.path), '-c', 'Debug']);
    if (build) return { toolchain: 'dotnet', manifest: project.path, packageManager: null, build, ...dotnetRun(ranked) };
  }
  return null;
}

/** `<manager> run build` / `<manager> run start` (or `dev`) from the root package.json. */
async function fromPackageJson(dir: string, files: readonly string[]): Promise<DetectedCommands | null> {
  if (!files.includes('package.json')) return null;
  const text = await readText(join(dir, 'package.json'));
  if (text === null) return null;

  let pkg: unknown;
  try {
    pkg = JSON.parse(text);
  } catch {
    return null;
  }
  const field = typeof pkg === 'object' && pkg !== null ? (pkg as { packageManager?: unknown }).packageManager : undefined;
  const packageManager = packageManagerFromField(field) ?? packageManagerFromLockfiles(files) ?? 'npm';
  const { build, run, runScript } = nodeCommands(pkg, packageManager);
  if (!build && !run) return null;
  return {
    toolchain: 'node',
    manifest: 'package.json',
    packageManager,
    build,
    run,
    runTarget: runScript,
    runKind: run ? 'script' : null,
  };
}

/** Solutions one folder down (`src/App.sln`), for repos that keep nothing buildable at the root. */
async function nestedSolutions(dir: string, folders: readonly string[]): Promise<string[]> {
  const searched = folders.filter((name) => !name.startsWith('.') && !SKIPPED_FOLDERS.has(name.toLowerCase())).slice(0, MAX_SUBFOLDERS);
  const found = await mapLimit(searched, READ_CONCURRENCY, async (folder) => {
    const listing = await listFolder(join(dir, folder));
    return (listing?.files ?? []).filter(isSolutionFile).map((file) => `${folder}/${file}`);
  });
  return found.flat();
}

/**
 * Detects a folder's build and run commands (AL-130, design §10). In order: a solution at the root
 * (`dotnet build <sln> -c Debug` / `dotnet run --project <proj>`), a project file at the root, the
 * root package.json's `build` and `start` (or `dev`) scripts with the repo's package manager, then
 * a solution one folder down. Null when none of them gives a command, or the folder cannot be read.
 *
 * Reads only files; runs nothing. `dir` is a repo's main checkout or a ticket worktree.
 */
export async function detectCommands(dir: string): Promise<DetectedCommands | null> {
  const root = await listFolder(dir);
  if (!root) return null;
  return (
    (await fromSolutions(dir, root.files.filter(isSolutionFile))) ??
    (await fromProjectFiles(dir, root.files.filter(isProjectFile))) ??
    (await fromPackageJson(dir, root.files)) ??
    (await fromSolutions(dir, await nestedSolutions(dir, root.folders)))
  );
}
