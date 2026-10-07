import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

/**
 * Workspace packages ship TypeScript source, so main and preload must bundle them
 * instead of leaving a runtime `require` of a .ts file.
 */
const workspacePackages = [
  '@agent-lanes/ado-client',
  '@agent-lanes/contracts',
  '@agent-lanes/tokens',
  '@agent-lanes/ui',
];

/**
 * ESM-only dependencies of the main process. The main bundle is CommonJS, and a runtime `require`
 * of an ES module returns its namespace instead of the default export, so these are bundled too.
 */
const esmOnlyMainDeps = ['electron-store'];

/** react-native-web resolves `*.web.*` platform files first (design §13: web-only code lives in *.web.tsx). */
const webExtensions = ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'];

/** A page slice's public API (`src/renderer/pages/<slice>/index.ts`), the module each lazy page chunk starts from. */
const pageEntry = /[\\/]src[\\/]renderer[\\/]pages[\\/]([^\\/]+)[\\/]index\.tsx?$/;

/** Lazily loaded pages (AL-140) get `page-<slice>` chunk names; Rollup would call them all `index`. */
function chunkFileName(chunk: { facadeModuleId: string | null }): string {
  const page = chunk.facadeModuleId ? pageEntry.exec(chunk.facadeModuleId)?.[1] : undefined;
  return page ? `assets/page-${page}-[hash].js` : 'assets/[name]-[hash].js';
}

export default defineConfig(({ command, mode }) => ({
  main: {
    build: {
      externalizeDeps: { exclude: [...workspacePackages, ...esmOnlyMainDeps] },
    },
  },
  preload: {
    build: {
      // The preload runs sandboxed, where only `electron` can be required, so bundle everything else.
      // One entry, so no code splitting; `isolatedEntries` is not needed (and fails without a TTY).
      externalizeDeps: false,
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer'),
        'react-native': 'react-native-web',
        // react-native-svg's web build asks for RN's asset registry, which RN no longer installs.
        '@react-native/assets-registry/registry': 'react-native-web/dist/modules/AssetRegistry',
      },
      extensions: webExtensions,
    },
    define: {
      __DEV__: JSON.stringify(command === 'serve'),
      // The component gallery (AL-032) is in `pnpm dev` and the e2e gallery build
      // (`electron-vite build --mode gallery`), never in a production build.
      __GALLERY__: JSON.stringify(command === 'serve' || mode === 'gallery'),
    },
    optimizeDeps: {
      esbuildOptions: {
        resolveExtensions: webExtensions,
      },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
        output: {
          chunkFileNames: chunkFileName,
        },
      },
      // Bundled fonts (AL-021) stay files: the CSP allows `font-src 'self'` only, so no data: URIs.
      assetsInlineLimit: (filePath: string) => (/\.woff2?$/.test(filePath) ? false : undefined),
    },
    plugins: [
      react({
        babel: {
          plugins: [['babel-plugin-react-compiler', {}]],
        },
      }),
    ],
  },
}));
