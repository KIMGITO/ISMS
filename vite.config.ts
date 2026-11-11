import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import { resolveAppVersion } from './scripts/app-version.mjs';

export default defineConfig(async ({ mode }) => {
  // CI stamps package.json; Vercel doesn't, so this falls back to git tags (see the script).
  const { version, source } = await resolveAppVersion();
  console.log(`App version ${version} (from ${source})`);
  return {
    plugins: [react(), tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __APP_COMMIT__: JSON.stringify((process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7)),
      // CI run number: goes up by one with every build, shown as the build number in About.
      __BUILD_NUMBER__: JSON.stringify(process.env.GITHUB_RUN_NUMBER || ''),
      __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    },
    // Production builds keep console.warn/error only, so routine logs can't expose business data.
    esbuild: {
      pure: mode === 'production' ? ['console.log', 'console.info', 'console.debug'] : [],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâ€”file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      chunkSizeWarningLimit: 2000, // Increased to suppress the warning without breaking the chunk graph
    },
    // The background-removal worker loads its runtime with dynamic imports, which needs ES workers.
    worker: {
      format: 'es',
    },
  };
});
