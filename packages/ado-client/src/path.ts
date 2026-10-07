/**
 * Builds a request path with every interpolated value URL-encoded as one path segment, so a project
 * or team name with spaces or slashes can't change which resource is addressed:
 *
 *   adoPath`/${project}/${team}/_apis/work/teamsettings/iterations`
 *   // project 'Onsite Companion', team 'Web/UI' → '/Onsite%20Companion/Web%2FUI/_apis/work/teamsettings/iterations'
 */
export function adoPath(strings: TemplateStringsArray, ...values: Array<string | number>): string {
  return strings.reduce((path, literal, index) => {
    const value = index < values.length ? encodeURIComponent(String(values[index])) : '';
    return path + literal + value;
  }, '');
}
