import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Feature-Sliced Design layer direction (design §5): a layer may import only the layers below it.
 * `widgets` (TB§6: the team board, the backlog popout) sits between pages and features.
 * Steiger (`pnpm lint:fsd`) checks the FSD semantics; these rules keep the direction honest in ESLint.
 */
const layers = ['app', 'processes', 'pages', 'widgets', 'features', 'entities', 'shared'];

function forbidUpperLayers(layer) {
  const index = layers.indexOf(layer);
  const above = layers.slice(0, index);
  // Slices on the same layer must not import each other either (shared has no slices).
  const sameLayer = ['pages', 'widgets', 'features', 'entities', 'processes'].includes(layer) ? [layer] : [];
  return [...above, ...sameLayer].map((name) => ({
    group: [`@/${name}`, `@/${name}/**`],
    message: `${layer} may not import from ${name} (FSD layer rule, design §5). Use relative imports inside a slice.`,
  }));
}

/** Packages that hold tokens or spawn processes stay in the main process (design §4, §8). */
const mainOnlyModules = ['electron', '@agent-lanes/ado-client', '@anthropic-ai/claude-agent-sdk', 'electron-store'];

/**
 * AL-023: every piece of text renders through the Text primitive's variants (design §11 Type), so
 * React Native's own Text stays inside packages/ui/src/Text.tsx. Tests may still render it as a fixture.
 */
const rawTextMessage =
  "Render text with Text from '@agent-lanes/ui' and a variant (display, title, body, meta, mono), design §11 Type.";
const rawTextRules = [
  {
    selector:
      "ImportDeclaration[source.value=/^react-native(-web)?$/][importKind!='type'] > ImportSpecifier[imported.name='Text'][importKind!='type']",
    message: rawTextMessage,
  },
  // Animated.Text, RN.Text and the like bypass the variants too.
  { selector: "JSXOpeningElement > JSXMemberExpression[property.name='Text']", message: rawTextMessage },
];

const deepSliceImport = {
  // The matcher has no brace expansion, so one glob per sliced layer.
  group: ['processes', 'pages', 'widgets', 'features', 'entities'].map((name) => `@/${name}/*/**`),
  message: "Import a slice through its public API (its index.ts), not its internals.",
};

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/out/**', '**/dist/**', '**/release/**', '**/test-results/**', '**/.turbo/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.{ts,mts,cts,mjs}'],
    ignores: ['apps/desktop/src/renderer/**', 'packages/ui/**'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat['recommended-latest'],
    languageOptions: { globals: globals.browser },
  },
  // Renderer: no Node, no Electron, no secret-holding packages.
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}', 'packages/tokens/src/index.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: mainOnlyModules.map((name) => ({ name, message: 'Main-process only: the renderer reaches it through IPC.' })),
          patterns: [{ group: ['node:*'], message: 'The renderer has no Node APIs; ask the main process over IPC.' }],
        },
      ],
    },
  },
  ...layers.map((layer) => ({
    files: [`apps/desktop/src/renderer/${layer}/**/*.{ts,tsx}`],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: mainOnlyModules.map((name) => ({ name, message: 'Main-process only: the renderer reaches it through IPC.' })),
          patterns: [
            { group: ['node:*'], message: 'The renderer has no Node APIs; ask the main process over IPC.' },
            deepSliceImport,
            ...forbidUpperLayers(layer),
          ],
        },
      ],
    },
  })),
  // All text goes through the Text variants (AL-023). A separate rule from no-restricted-imports,
  // so it adds to the layer rules above instead of replacing them.
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    ignores: ['packages/ui/src/Text.tsx', '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...rawTextRules],
    },
  },
  // Main and preload never import UI code.
  {
    files: ['apps/desktop/src/main/**/*.ts', 'apps/desktop/src/preload/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['react', 'react-native', 'react-native-web', '@agent-lanes/ui'].map((name) => ({
            name,
            message: 'UI code belongs in the renderer.',
          })),
          patterns: [{ group: ['**/renderer/**'], message: 'Main and preload never import renderer code.' }],
        },
      ],
    },
  },
);
