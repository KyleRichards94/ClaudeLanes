/**
 * Detected commands are command lines (the same shape as a user's override), so they must run the
 * same whichever shell starts them: cmd.exe on Windows or a POSIX shell elsewhere (AL-132).
 */

/** Arguments made only of these characters need no quotes in either shell. */
const PLAIN = /^[A-Za-z0-9_\-.,/:=@+]+$/;

/**
 * Characters double quotes do not protect in one of the two shells: `"` itself, `%` and `!` (cmd
 * variable expansion), `$`, backtick and backslash (sh), and control characters.
 */
// eslint-disable-next-line no-control-regex -- control characters are exactly what this refuses
const UNQUOTABLE = /["%!$`\\\u0000-\u001f\u007f]/;

/**
 * One argument as it should appear on a command line: as is when plain, in double quotes when it
 * holds spaces or other shell characters, or null when no quoting is safe in both shells.
 */
export function quoteArg(arg: string): string | null {
  if (arg.length === 0) return '""';
  if (PLAIN.test(arg)) return arg;
  if (UNQUOTABLE.test(arg)) return null;
  return `"${arg}"`;
}

/** The arguments joined into one command line, or null when one of them cannot be quoted safely. */
export function commandLine(args: readonly string[]): string | null {
  const quoted: string[] = [];
  for (const arg of args) {
    const safe = quoteArg(arg);
    if (safe === null) return null;
    quoted.push(safe);
  }
  return quoted.join(' ');
}

/**
 * A path relative to the detected folder, as a command argument: forward slashes (dotnet and node
 * accept them on Windows too), and `./` in front of a name starting with `-` so it is never read as
 * an option.
 */
export function pathArg(relativePath: string): string {
  const forward = relativePath.replace(/\\/g, '/');
  return forward.startsWith('-') ? `./${forward}` : forward;
}
