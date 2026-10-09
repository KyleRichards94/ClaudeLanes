import type { RunTargetKind } from '@agent-lanes/contracts';
import { stripXmlComments } from './solution';

/** What a project file says about running it. */
export interface ProjectInfo {
  /** SDK-style (`<Project Sdk="…">`); only these can be started with `dotnet run`. */
  sdkStyle: boolean;
  /** What running it starts; null for a library. */
  kind: Exclude<RunTargetKind, 'script'> | null;
  /** A test project, which `dotnet run` does not start. */
  test: boolean;
}

/** SDKs whose projects are web apps (and default to OutputType Exe). */
const WEB_SDKS = new Set(['microsoft.net.sdk.web', 'microsoft.net.sdk.blazorwebassembly']);
/** SDKs that default to OutputType Exe. */
const EXE_SDKS = new Set(['microsoft.net.sdk.worker', ...WEB_SDKS]);
const TEST_SDKS = new Set(['mstest.sdk']);

/** `Microsoft.NET.Sdk.Web/9.0.100;Other.Sdk` → `['microsoft.net.sdk.web', 'other.sdk']`. */
function sdkNames(value: string): string[] {
  return value
    .split(';')
    .map((sdk) => sdk.split('/')[0]?.trim().toLowerCase() ?? '')
    .filter(Boolean);
}

/** SDKs from `<Project Sdk>`, `<Sdk Name>` and `<Import Sdk>`. */
function projectSdks(xml: string): string[] {
  const sdks: string[] = [];
  const project = /<Project\b[^>]*?\bSdk\s*=\s*"([^"]*)"/i.exec(xml);
  if (project?.[1]) sdks.push(...sdkNames(project[1]));
  for (const [, name = ''] of xml.matchAll(/<Sdk\b[^>]*?\bName\s*=\s*"([^"]*)"/gi)) sdks.push(...sdkNames(name));
  for (const [, name = ''] of xml.matchAll(/<Import\b[^>]*?\bSdk\s*=\s*"([^"]*)"/gi)) sdks.push(...sdkNames(name));
  return sdks;
}

/** The last value of a property (MSBuild lets a later definition win), lower-cased; undefined when unset. */
function property(xml: string, name: string): string | undefined {
  let value: string | undefined;
  for (const [, found = ''] of xml.matchAll(new RegExp(`<${name}\\b[^>]*>([^<]*)</${name}>`, 'gi'))) {
    value = found.trim().toLowerCase();
  }
  return value;
}

/**
 * `Foo.Tests`, `Foo.Test`, `Foo-tests`, `FooTests`, `Foo.UnitTests` are test projects by name;
 * `Latest` or `Contest` are not (a bare suffix needs a capital T).
 */
export function isTestProjectName(name: string): boolean {
  return /(?:^|[._-])tests?$/i.test(name) || /[a-z0-9]Tests?$/.test(name);
}

/**
 * Reads a .csproj/.vbproj/.fsproj without MSBuild: enough to tell a web app, a desktop app and a
 * console app from a library or a test project. Conditions and imported props are not evaluated.
 */
export function classifyProject(name: string, rawXml: string): ProjectInfo {
  const xml = stripXmlComments(rawXml);
  const sdks = projectSdks(xml);
  const sdkStyle = sdks.length > 0;

  const outputType = property(xml, 'OutputType') ?? (sdks.some((sdk) => EXE_SDKS.has(sdk)) ? 'exe' : 'library');
  const web = sdks.some((sdk) => WEB_SDKS.has(sdk));
  const desktopUi = ['UseWindowsForms', 'UseWPF', 'UseWinUI'].some((flag) => property(xml, flag) === 'true');

  let kind: ProjectInfo['kind'] = null;
  if (outputType === 'winexe' || outputType === 'appcontainerexe') kind = 'desktop';
  else if (outputType === 'exe') kind = web ? 'web' : desktopUi ? 'desktop' : 'console';

  const isTestProject = property(xml, 'IsTestProject');
  const test =
    isTestProject !== undefined
      ? isTestProject === 'true'
      : sdks.some((sdk) => TEST_SDKS.has(sdk)) ||
        /<PackageReference\b[^>]*?\bInclude\s*=\s*"Microsoft\.NET\.Test\.Sdk"/i.test(xml) ||
        isTestProjectName(name);

  return { sdkStyle, kind, test };
}

/** Web apps first (they are what a repo usually "runs"), then desktop apps, then console apps. */
const KIND_RANK: Record<NonNullable<ProjectInfo['kind']>, number> = { web: 0, desktop: 1, console: 2 };

/** `OnSite Companion Solution` → `onsitecompanion`: letters and digits, without a trailing "solution". */
function solutionStem(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/solution$/, '');
}

export interface RankRunOptions {
  /** Visual Studio's start-up project for the solution (its `.sln` id), from the `.suo`. */
  startupId?: string | null;
  /** The solution's file name without extension. */
  solutionName?: string;
}

/**
 * The projects `dotnet run` can start, best first: runnable, SDK-style and not a test project.
 * Visual Studio's saved start-up project leads; then projects whose first name part matches the
 * solution's name (`OnSiteCompanion.WinExe` in `OnSite Companion Solution.sln`); then web before
 * desktop before console, then in the order given (solution order). The repo's run override
 * (AL-146) still wins over all of this.
 */
export function rankRunProjects<T extends { info: ProjectInfo; name: string; id?: string }>(projects: readonly T[], options: RankRunOptions = {}): T[] {
  const startupId = options.startupId?.toUpperCase();
  const stem = options.solutionName ? solutionStem(options.solutionName) : '';
  const runnable = (project: T) => project.info.kind !== null && project.info.sdkStyle;
  const startup = startupId ? projects.find((project) => project.id === startupId && runnable(project)) : undefined;
  const named = (project: T) => (stem !== '' && solutionStem(project.name.split('.')[0] ?? '') === stem ? 0 : 1);
  // Array.prototype.sort is stable, so solution order holds within a kind.
  const ranked = projects
    .filter((project) => project !== startup && runnable(project) && !project.info.test)
    .sort((a, b) => named(a) - named(b) || rank(a.info) - rank(b.info));
  return startup ? [startup, ...ranked] : ranked;
}

function rank(info: ProjectInfo): number {
  return info.kind ? KIND_RANK[info.kind] : Number.MAX_SAFE_INTEGER;
}
