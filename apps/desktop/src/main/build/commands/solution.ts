import { posix } from 'node:path';

/** MSBuild project files `dotnet build` and `dotnet run` take. */
export const PROJECT_EXTENSIONS = ['.csproj', '.vbproj', '.fsproj'] as const;
/** Solution files: the classic text format and the XML format (.NET SDK 9.0.200+). */
export const SOLUTION_EXTENSIONS = ['.sln', '.slnx'] as const;

/** One project listed in a solution. */
export interface SolutionProject {
  /** The project's name in the solution. */
  name: string;
  /** Path relative to the solution's folder, forward slashes, normalised (may start with `../`). */
  path: string;
  /** The project's id in a classic `.sln` (upper-case GUID, no braces); Visual Studio's start-up setting names it. */
  id?: string;
}

function hasExtension(path: string, extensions: readonly string[]): boolean {
  const lower = path.toLowerCase();
  return extensions.some((extension) => lower.endsWith(extension));
}

export function isProjectFile(path: string): boolean {
  return hasExtension(path, PROJECT_EXTENSIONS);
}

export function isSolutionFile(path: string): boolean {
  return hasExtension(path, SOLUTION_EXTENSIONS);
}

/**
 * A project path as written in a solution, made relative and forward-slashed; null for what `dotnet`
 * cannot build from the repo: web-site folders, URLs, absolute paths and non-project entries.
 */
function projectPath(raw: string): string | null {
  const path = raw.trim().replace(/\\/g, '/');
  if (!isProjectFile(path)) return null;
  if (posix.isAbsolute(path) || /^[A-Za-z]:/.test(path) || /^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return null;
  return posix.normalize(path);
}

/** Solution folders are listed as projects with this type GUID; they are not built. */
const SOLUTION_FOLDER_TYPE = '2150E333-8FDC-42A3-9474-1A3956D46DE8';
/** `Project("{type}") = "Name", "Path\To\Name.csproj", "{guid}"` */
const SLN_PROJECT = /^[ \t]*Project\("\{([0-9A-Fa-f-]+)\}"\)[ \t]*=[ \t]*"([^"]*)"[ \t]*,[ \t]*"([^"]*)"(?:[ \t]*,[ \t]*"\{([0-9A-Fa-f-]+)\}")?/gm;

/** Projects in a classic `.sln`, in the order the solution lists them. */
export function parseSln(text: string): SolutionProject[] {
  const projects: SolutionProject[] = [];
  for (const [, type = '', name = '', rawPath = '', id] of text.matchAll(SLN_PROJECT)) {
    if (type.toUpperCase() === SOLUTION_FOLDER_TYPE) continue;
    const path = projectPath(rawPath);
    if (path) projects.push(id ? { name, path, id: id.toUpperCase() } : { name, path });
  }
  return projects;
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity: string) => XML_ENTITIES[entity] ?? '');
}

/** Removes `<!-- … -->` so commented-out elements are not read. */
export function stripXmlComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

/** `<Project Path="src/App/App.csproj" />`, also inside `<Folder>`. */
const SLNX_PROJECT = /<Project\b([^>]*)>/gi;
const PATH_ATTRIBUTE = /\bPath\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

/** Projects in an XML `.slnx`, in document order. Names are the file names without extension, as the SDK shows them. */
export function parseSlnx(text: string): SolutionProject[] {
  const projects: SolutionProject[] = [];
  for (const [, attributes = ''] of stripXmlComments(text).matchAll(SLNX_PROJECT)) {
    const match = PATH_ATTRIBUTE.exec(attributes);
    const raw = match?.[1] ?? match?.[2];
    if (raw === undefined) continue;
    const path = projectPath(decodeXml(raw));
    if (path) projects.push({ name: posix.basename(path).replace(/\.[^.]+$/, ''), path });
  }
  return projects;
}

/** Projects in a solution file of either format. */
export function parseSolution(fileName: string, text: string): SolutionProject[] {
  return fileName.toLowerCase().endsWith('.slnx') ? parseSlnx(text) : parseSln(text);
}
