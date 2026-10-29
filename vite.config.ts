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

// `npm run dev:landing` shows the public landing page as a visitor sees it: the membership gate is on and
// /api answers as for a signed-out visitor (there is no account service in `vite` itself).
const landingPreview = (): Plugin => ({
  name: 'landing-preview',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/api/config', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ auth: true, billing: true }));
    });
    server.middlewares.use('/api/session', (_req, res) => {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ user: null }));
    });
  },
});

// Cornerstone3D v5 + Vite, following the official integration guide:
// CommonJS shim for dicom-parser, keep the DICOM loader (and its codec WASM)
// out of dev pre-bundling, and emit ES-module workers.
export default defineConfig(({ mode }) => ({
  plugins: [react(), viteCommonjs(), neverShipTheBook(), ...(mode === 'landing' ? [landingPreview()] : [])],
  define: mode === 'landing' ? { 'import.meta.env.VITE_REQUIRE_SIGN_IN': JSON.stringify('1') } : {},
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
}));
