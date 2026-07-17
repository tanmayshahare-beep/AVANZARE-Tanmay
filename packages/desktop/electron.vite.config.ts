import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// The engine is bundled from source into the main-process bundle (electron-builder
// cannot package workspace symlinks); only real npm deps stay external.
const engineSrc = resolve(__dirname, '../engine/src/index.ts');

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@avanzare/engine': engineSrc } },
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] },
});
