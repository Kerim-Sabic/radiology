import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';
import { prepareCommercialContent } from './scripts/build/commercialContent';
import { computeFreeEdition, writeFreeEdition } from './scripts/build/freeEdition';
import { FREE_CASES, WEEKLY_CASES, WEEKLY_EPOCH } from './src/content/weekly';

const FREE_SCHEDULE = { epoch: WEEKLY_EPOCH, always: FREE_CASES, weekly: WEEKLY_CASES };

// The owner's textbook PDF may sit in public/book for private local use.
// Published builds always exclude it.
const neverShipTheBook = (): Plugin => ({
  name: 'never-ship-the-book',
  apply: 'build',
  closeBundle() {
    // Paid deployments never distribute the owner's textbook, even if a local legacy flag is set.
    rmSync(resolve(__dirname, 'dist', 'book'), { recursive: true, force: true });
    prepareCommercialContent(resolve(__dirname, 'dist'));
    // The free edition (sample patients, cases of the week, teaser list) is cut from the commercial packs.
    writeFreeEdition(resolve(__dirname, 'dist', 'packs'), FREE_SCHEDULE);
  },
});

// In `vite` (dev) the free-edition files are computed from public/packs on request, so free mode can be tried locally.
const freeEditionDev = (): Plugin => ({
  name: 'free-edition-dev',
  apply: 'serve',
  configureServer(server) {
    let cache: { at: number; outputs: Array<{ rel: string; json: unknown }> } | null = null;
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? '').split('?')[0];
      if (!/^\/packs\/(index\.free\.json|teaser\.json|[\w-]+\/(pack|lessons)\.free\.json)$/.test(path)) return next();
      const rel = path.slice('/packs/'.length);
      // One computation serves the burst of requests a page load makes.
      if (!cache || Date.now() - cache.at > 5000) cache = { at: Date.now(), outputs: computeFreeEdition(resolve(__dirname, 'public', 'packs'), FREE_SCHEDULE).outputs };
      const out = cache.outputs.find((o) => o.rel === rel);
      if (!out) return next();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(out.json));
    });
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
    // /api/mock?as=free|member|out switches the pretend account (a cookie), to preview each view of the gate.
    server.middlewares.use('/api/mock', (req, res) => {
      const as = new URL(req.url ?? '', 'http://x').searchParams.get('as') ?? 'out';
      res.statusCode = 303;
      res.setHeader('Set-Cookie', `rvm-mock=${as}; Path=/`);
      res.setHeader('Location', '/');
      res.end();
    });
    server.middlewares.use('/api/session', (req, res) => {
      const as = /(?:^|;\s*)rvm-mock=(\w+)/.exec(req.headers.cookie ?? '')?.[1];
      const user = { name: 'Test Student', email: 'student@example.com' };
      res.setHeader('Content-Type', 'application/json');
      if (as === 'free') return res.end(JSON.stringify({ user, access: { active: false }, billingReady: true, book: false }));
      if (as === 'member') return res.end(JSON.stringify({ user, access: { active: true, tier: 'yearly', expiresAt: null }, billingReady: true, book: false }));
      res.statusCode = 401;
      res.end(JSON.stringify({ user: null }));
    });
  },
});

// Cornerstone3D v5 + Vite, following the official integration guide:
// CommonJS shim for dicom-parser, keep the DICOM loader (and its codec WASM)
// out of dev pre-bundling, and emit ES-module workers.
export default defineConfig(({ mode }) => ({
  plugins: [react(), viteCommonjs(), neverShipTheBook(), freeEditionDev(), ...(mode === 'landing' ? [landingPreview()] : [])],
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
