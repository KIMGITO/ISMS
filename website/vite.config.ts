import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  envDir: path.resolve(__dirname, '..'),
  plugins: [react(), tailwindcss()],
  server: { port: 5180 },
  build: { outDir: 'dist', emptyOutDir: true },
});
