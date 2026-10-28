import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';
import { prepareCommercialContent } from './scripts/build/commercialContent';

// The owner's textbook PDF may sit in public/book for private local use.
// Published builds always exclude it.
const neverShipTheBook = (): Plugin => ({
  name: 'never-ship-the-book',
  apply: 'build',
  closeBundle() {
    // Paid deployments never distribute the owner's textbook, even if a local legacy flag is set.
    rmSync(resolve(__dirname, 'dist', 'book'), { recursive: true, force: true });
    prepareCommercialContent(resolve(__dirname, 'dist'));
  },
});

// Cornerstone3D v5 + Vite, following the official integration guide:
// CommonJS shim for dicom-parser, keep the DICOM loader (and its codec WASM)
// out of dev pre-bundling, and emit ES-module workers.
export default defineConfig({
  plugins: [react(), viteCommonjs(), neverShipTheBook()],
  resolve: {
    // vtk.js → xmlbuilder2 extends Node's EventEmitter; use the browser polyfill instead of an empty stub.
    alias: { events: 'events/' },
  },
  optimizeDeps: {
    exclude: ['@cornerstonejs/dicom-image-loader'],
    include: ['dicom-parser'],
  },
  worker: {
    format: 'es',
  },
  assetsInclude: ['**/*.wasm'],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
  },
  server: {
    port: 5173,
  },
});
