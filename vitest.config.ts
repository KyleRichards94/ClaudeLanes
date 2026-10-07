import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rendererRoot = fileURLToPath(new URL('./apps/desktop/src/renderer', import.meta.url));
const webExtensions = ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js', '.mjs', '.json'];

/**
 * Test levels from design §12. Node projects cover packages and the main process;
 * the jsdom project renders React Native components through react-native-web,
 * the same way the Electron renderer does.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'packages',
          environment: 'node',
          include: ['packages/{contracts,tokens,ado-client}/src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'main',
          environment: 'node',
          include: ['apps/desktop/src/main/**/*.test.ts', 'apps/desktop/src/preload/**/*.test.ts', 'apps/desktop/scripts/**/*.test.ts'],
        },
      },
      {
        resolve: {
          alias: {
            '@': rendererRoot,
            'react-native': 'react-native-web',
            // Tests resolve packages by `main`, which for react-native-svg is the native CommonJS
            // build; its ESM build picks the `*.web.js` files, as the renderer bundle does.
            'react-native-svg': 'react-native-svg/lib/module/index.js',
            // react-native-svg's web build asks for RN's asset registry, which RN no longer installs.
            '@react-native/assets-registry/registry': 'react-native-web/dist/modules/AssetRegistry',
          },
          extensions: webExtensions,
        },
        define: {
          __DEV__: 'true',
        },
        esbuild: {
          jsx: 'automatic',
        },
        test: {
          name: 'ui',
          environment: 'jsdom',
          // RN libraries ship `*.web.js` files and import 'react-native'; Vite must resolve them
          // (alias + web extensions) instead of Node loading their native entry.
          server: { deps: { inline: [/react-native-svg/, /lucide-react-native/] } },
          include: ['packages/ui/src/**/*.test.tsx', 'apps/desktop/src/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['./apps/desktop/src/renderer/shared/testing/setup.ts'],
        },
      },
    ],
  },
});
