import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';

// The owner's textbook PDF may sit in public/book for private local use. A build leaves it out unless
// KEEP_BOOK_IN_BUILD=1, so an uploaded dist/ folder can never publish the copyrighted book by accident.
const neverShipTheBook = (): Plugin => ({
  name: 'never-ship-the-book',
  apply: 'build',
  closeBundle() {
    if (process.env.KEEP_BOOK_IN_BUILD !== '1') rmSync(resolve(__dirname, 'dist', 'book'), { recursive: true, force: true });
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
    sourcemap: true,
    chunkSizeWarningLimit: 4000,
  },
  server: {
    port: 5173,
  },
});
