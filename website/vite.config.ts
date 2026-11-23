import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { resolveAppVersion } from '../scripts/app-version.mjs';

// The website ships in the same release as the app, so it carries the app's version.
export default defineConfig(async () => {
  const { version, source } = await resolveAppVersion();
  console.log(`Website version ${version} (from ${source})`);
  return {
    root: __dirname,
    envDir: path.resolve(__dirname, '..'),
    plugins: [react(), tailwindcss()],
    define: { __SITE_VERSION__: JSON.stringify(version) },
    server: { port: 5180 },
    build: { outDir: 'dist', emptyOutDir: true },
  };
});
