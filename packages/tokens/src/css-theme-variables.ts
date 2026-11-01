/**
 * Reads agent-lanes-tokens.css into one map of `--al-*` variables per theme: every `:root { }`
 * block is the light theme, every `:root[data-theme='x'] { }` block is theme x. For the tests.
 */
export function cssThemeVariables(css: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const block of css.matchAll(/:root(?:\[data-theme='([a-z]+)'\])?\s*\{([^}]*)\}/g)) {
    const theme = block[1] ?? 'light';
    const vars = (result[theme] ??= {});
    for (const declaration of (block[2] ?? '').matchAll(/--al-([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      vars[declaration[1] ?? ''] = (declaration[2] ?? '').trim();
    }
  }
  return result;
}
