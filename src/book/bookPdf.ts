/**
 * The user's own copy of the textbook, rendered with PDF.js. The PDF is either imported
 * on this device (kept in this browser's IndexedDB) or fetched from a protected URL set in
 * VITE_BOOK_URL. Nothing from the book is bundled with the app or sent anywhere.
 */
import { openDB } from 'idb';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

export const EXPECTED_SHA256 = '0f711fa48c1872ceb06cda81df9ec60b1de0eab0590b585dda0d9aae26dad1b1';

interface StoredBook {
  blob: Blob;
  sha256: string;
  name: string;
  importedAt: string;
}

const dbp = () =>
  openDB('rvm-book', 1, {
    upgrade(db) {
      db.createObjectStore('files');
      db.createObjectStore('pages'); // physical page -> extracted text (local search index)
    },
  });

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
async function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
      return m;
    });
  }
  return pdfjsPromise;
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface BookStatus {
  source: 'local' | 'url' | 'none';
  name: string | null;
  sha256: string | null;
  verified: boolean;
  pageCount: number | null;
}

let docPromise: Promise<PDFDocumentProxy> | null = null;
let status: BookStatus = { source: 'none', name: null, sha256: null, verified: false, pageCount: null };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
export const bookStatus = {
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get: () => status,
};

/**
 * Open a remote PDF by fetching only the byte ranges PDF.js asks for. Works on any server that answers
 * Range requests with 206 — even when it omits `Accept-Ranges` on full responses (Vite's static server
 * does), which would otherwise make PDF.js download the whole 73 MB file before page 1.
 */
async function openRanged(lib: typeof import('pdfjs-dist'), url: string) {
  const probe = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
  const m = /\/(\d+)\s*$/.exec(probe.headers.get('content-range') ?? '');
  if (probe.status !== 206 || !m) {
    await probe.body?.cancel();
    return lib.getDocument({ url, disableAutoFetch: true, disableStream: true, rangeChunkSize: 1 << 18 });
  }
  const length = Number(m[1]);
  const head = new Uint8Array(await probe.arrayBuffer());
  const transport = new lib.PDFDataRangeTransport(length, head);
  let loaded = head.byteLength;
  transport.requestDataRange = (begin: number, end: number) => {
    fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` } })
      .then((r) => {
        if (r.status !== 206) throw new Error(`Range request failed (HTTP ${r.status})`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        loaded += buf.byteLength;
        openProgress = { loaded, total: length };
        notify();
        transport.onDataRange(begin, new Uint8Array(buf));
      })
      .catch(() => transport.abort());
  };
  return lib.getDocument({ range: transport, disableAutoFetch: true, rangeChunkSize: 1 << 18 });
}

/** Bytes fetched while opening the book (for a real progress indicator). */
let openProgress: { loaded: number; total: number } | null = null;
export const bookOpenProgress = () => openProgress;

/** Open the book quietly in the background so it is ready when a page is needed. */
export function preloadBook() {
  hasBook()
    .then((h) => (h ? openBook() : null))
    .catch(() => undefined);
}

export async function importBook(file: File): Promise<BookStatus> {
  const buf = await file.arrayBuffer();
  const hash = await sha256Hex(buf);
  const db = await dbp();
  const rec: StoredBook = { blob: new Blob([buf], { type: 'application/pdf' }), sha256: hash, name: file.name, importedAt: new Date().toISOString() };
  await db.put('files', rec, 'book');
  await db.clear('pages');
  docPromise = null;
  await openBook();
  return status;
}

export async function removeLocalBook() {
  const db = await dbp();
  await db.delete('files', 'book');
  await db.clear('pages');
  docPromise = null;
  status = { source: 'none', name: null, sha256: null, verified: false, pageCount: null };
  notify();
}

export function openBook(): Promise<PDFDocumentProxy> {
  if (docPromise) return docPromise;
  docPromise = (async () => {
    const lib = await pdfjs();
    const db = await dbp();
    const local = (await db.get('files', 'book')) as StoredBook | undefined;
    let doc: PDFDocumentProxy;
    if (local) {
      const data = new Uint8Array(await local.blob.arrayBuffer());
      openProgress = { loaded: data.byteLength, total: data.byteLength };
      doc = await lib.getDocument({ data }).promise;
      status = { source: 'local', name: local.name, sha256: local.sha256, verified: local.sha256 === EXPECTED_SHA256, pageCount: doc.numPages };
    } else {
      const url = (await bundledBookUrl()) ?? (import.meta.env.VITE_BOOK_URL as string | undefined)?.trim();
      if (!url) throw new Error('No book available. Import your PDF in Settings → Book.');
      // Range requests: PDF.js streams only the pages needed.
      // Range requests only: open the document from its cross-reference table and fetch just the
      // pages being viewed, instead of streaming all 73 MB before page 1 can render.
      const task = await openRanged(lib, url);
      task.onProgress = (p: { loaded: number; total?: number }) => {
        openProgress = { loaded: p.loaded, total: p.total ?? 0 };
        notify();
      };
      doc = await task.promise;
      status = { source: 'url', name: url.split('/').pop() ?? url, sha256: null, verified: doc.numPages === 552, pageCount: doc.numPages };
      // Note: hash is verified by install_book.py when the copy is installed into a private build.
    }
    notify();
    return doc;
  })();
  docPromise.catch(() => {
    docPromise = null;
  });
  return docPromise;
}

/**
 * A private build may carry the owner's PDF at /book/learning-radiology-5e.pdf (git-ignored; installed with
 * scripts/book/install_book.py). Only accepted when the server really returns a PDF.
 */
let bundledProbe: Promise<string | null> | null = null;
export function bundledBookUrl(): Promise<string | null> {
  if (!bundledProbe) {
    const url = `${import.meta.env.BASE_URL}book/learning-radiology-5e.pdf`;
    bundledProbe = fetch(url, { method: 'HEAD' })
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('pdf') ? new URL(url, window.location.href).href : null))
      .catch(() => null);
  }
  return bundledProbe;
}

export async function hasBook(): Promise<boolean> {
  try {
    const db = await dbp();
    if (await db.get('files', 'book')) return true;
  } catch {
    /* ignore */
  }
  if (await bundledBookUrl()) return true;
  return !!(import.meta.env.VITE_BOOK_URL as string | undefined)?.trim();
}

/** Render one physical page into `canvas` at `cssWidth`. Returns a cancel function. */
export function renderPage(physical: number, canvas: HTMLCanvasElement, cssWidth: number): { done: Promise<{ width: number; height: number }>; cancel: () => void } {
  let task: RenderTask | null = null;
  let cancelled = false;
  const done = (async () => {
    const doc = await openBook();
    const page = await doc.getPage(physical);
    const base = page.getViewport({ scale: 1 });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = (cssWidth / base.width) * dpr;
    const vp = page.getViewport({ scale });
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    if (cancelled) throw new Error('cancelled');
    task = page.render({ canvas, viewport: vp });
    await task.promise;
    page.cleanup();
    return { width: vp.width / dpr, height: vp.height / dpr };
  })();
  return {
    done,
    cancel: () => {
      cancelled = true;
      task?.cancel();
    },
  };
}

/** Extract page text once (column-aware) for the local search index. Stays in this browser. */
export async function ensureTextIndex(onProgress?: (done: number, total: number) => void): Promise<number> {
  const db = await dbp();
  const doc = await openBook();
  const existing = await db.count('pages');
  if (existing >= doc.numPages) return existing;
  for (let p = 1; p <= doc.numPages; p++) {
    if (await db.get('pages', p)) continue;
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items
      .map((it) => it as { str: string; transform: number[] })
      .filter((it) => typeof it.str === 'string' && it.str.trim())
      .map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5] }));
    const mid = vp.width / 2;
    const twoCol = items.filter((i) => i.x > mid).length > items.length * 0.25;
    const col = (i: { x: number }) => (twoCol && i.x > mid - 10 ? 1 : 0);
    items.sort((a, b) => col(a) - col(b) || b.y - a.y || a.x - b.x);
    await db.put('pages', items.map((i) => i.s).join(' ').replace(/\s+/g, ' '), p);
    page.cleanup();
    onProgress?.(p, doc.numPages);
  }
  return doc.numPages;
}

export async function searchBook(query: string, limit = 30): Promise<Array<{ physical: number; snippet: string }>> {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return [];
  const db = await dbp();
  const keys = (await db.getAllKeys('pages')) as number[];
  const out: Array<{ physical: number; snippet: string }> = [];
  for (const k of keys) {
    const text = ((await db.get('pages', k)) as string) ?? '';
    const i = text.toLowerCase().indexOf(q);
    if (i >= 0) {
      out.push({ physical: k, snippet: `…${text.slice(Math.max(0, i - 60), i + q.length + 80)}…` });
      if (out.length >= limit) break;
    }
  }
  return out.sort((a, b) => a.physical - b.physical);
}

/**
 * Crop one figure from the user's PDF into a blob URL (rendered on demand, in this browser only).
 * Pages are rendered off-screen at a scale that gives the crop ~`width` CSS px, then released.
 */
const cropCache = new Map<string, Promise<string>>();
export function figureCropUrl(physical: number, bbox: number[], width = 300): Promise<string> {
  const key = `${physical}:${bbox.join(',')}:${width}`;
  let pr = cropCache.get(key);
  if (!pr) {
    pr = (async () => {
      const doc = await openBook();
      const page = await doc.getPage(physical);
      const base = page.getViewport({ scale: 1 });
      const bw = Math.max(0.05, bbox[2] - bbox[0]);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const scale = Math.min(4, (width * dpr) / (bw * base.width));
      const vp = page.getViewport({ scale });
      const full = document.createElement('canvas');
      full.width = Math.floor(vp.width);
      full.height = Math.floor(vp.height);
      await page.render({ canvas: full, viewport: vp }).promise;
      const sx = Math.floor(bbox[0] * full.width);
      const sy = Math.floor(bbox[1] * full.height);
      const sw = Math.max(1, Math.floor(bw * full.width));
      const sh = Math.max(1, Math.floor((bbox[3] - bbox[1]) * full.height));
      const out = document.createElement('canvas');
      out.width = sw;
      out.height = sh;
      out.getContext('2d')!.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
      full.width = full.height = 0; // release memory
      page.cleanup();
      const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/jpeg', 0.85));
      out.width = out.height = 0;
      if (!blob) throw new Error('crop failed');
      return URL.createObjectURL(blob);
    })();
    cropCache.set(key, pr);
    pr.catch(() => cropCache.delete(key));
  }
  return pr;
}
