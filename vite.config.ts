import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';

// Cornerstone3D v5 + Vite, following the official integration guide:
// CommonJS shim for dicom-parser, keep the DICOM loader (and its codec WASM)
// out of dev pre-bundling, and emit ES-module workers.
export default defineConfig({
  plugins: [react(), viteCommonjs()],
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
