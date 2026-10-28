/**
 * Fetches DICOM Part 10 files for one series with bounded concurrency, real byte progress,
 * cancellation and priority ordering (requested slice first, then outward), and registers
 * them with Cornerstone's metadata layer so the image loader never fetches them twice.
 */
import { cs } from './csInit';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';

export interface FetchProgress {
  done: number;
  failed: number;
  total: number;
  bytes: number;
  elapsedMs: number;
}

const NATURALIZED = 'naturalized';

export function isRegistered(imageId: string): boolean {
  try {
    return !!cs.metaData.get(NATURALIZED, imageId);
  } catch {
    return false;
  }
}

export class SeriesFetcher {
  private queue: number[] = [];
  private inFlight = new Set<number>();
  private status: Array<'pending' | 'loading' | 'done' | 'failed'>;
  private controller = new AbortController();
  private listeners = new Set<(p: FetchProgress) => void>();
  private waiters = new Map<number, Array<(ok: boolean) => void>>();
  private allWaiters: Array<() => void> = [];
  private bytes = 0;
  private t0 = performance.now();
  readonly errors = new Map<number, string>();

  constructor(
    readonly imageIds: string[],
    readonly urls: string[],
    private concurrency = 6,
  ) {
    this.status = imageIds.map((id) => (isRegistered(id) ? 'done' : 'pending'));
  }

  get progress(): FetchProgress {
    return {
      done: this.status.filter((s) => s === 'done').length,
      failed: this.status.filter((s) => s === 'failed').length,
      total: this.imageIds.length,
      bytes: this.bytes,
      elapsedMs: performance.now() - this.t0,
    };
  }

  onProgress(fn: (p: FetchProgress) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Begin fetching everything, centred on `startIndex`. */
  start(startIndex = 0) {
    this.prioritize(startIndex);
    this.pump();
  }

  /** Re-centre the queue on `index` (e.g. when the learner scrolls far away). */
  prioritize(index: number) {
    const n = this.imageIds.length;
    const order: number[] = [];
    for (let d = 0; d < n; d++) {
      const a = index + d;
      const b = index - d;
      if (a < n && !order.includes(a)) order.push(a);
      if (d > 0 && b >= 0) order.push(b);
    }
    this.queue = order.filter((i) => this.status[i] === 'pending' || this.status[i] === 'failed');
    this.pump();
  }

  whenReady(index: number): Promise<boolean> {
    if (this.status[index] === 'done') return Promise.resolve(true);
    if (this.status[index] === 'failed') return Promise.resolve(false);
    return new Promise((res) => {
      const arr = this.waiters.get(index) ?? [];
      arr.push(res);
      this.waiters.set(index, arr);
    });
  }

  whenAllSettled(): Promise<void> {
    if (this.status.every((s) => s === 'done' || s === 'failed')) return Promise.resolve();
    return new Promise((res) => this.allWaiters.push(res));
  }

  retryFailed() {
    this.status = this.status.map((s) => (s === 'failed' ? 'pending' : s));
    this.errors.clear();
    this.prioritize(this.queue[0] ?? 0);
  }

  abort() {
    this.controller.abort();
    this.queue = [];
    // Nobody may wait forever on a cancelled series: pending waiters learn that it will not load.
    for (const i of [...this.waiters.keys()]) this.resolve(i, false);
    for (const w of this.allWaiters.splice(0)) w();
  }

  get aborted() {
    return this.controller.signal.aborted;
  }

  private emit() {
    const p = this.progress;
    for (const l of this.listeners) l(p);
    if (p.done + p.failed === p.total) {
      for (const w of this.allWaiters.splice(0)) w();
    }
  }

  private pump() {
    while (this.inFlight.size < this.concurrency && this.queue.length && !this.aborted) {
      const i = this.queue.shift()!;
      if (this.status[i] !== 'pending' && this.status[i] !== 'failed') continue;
      this.load(i);
    }
    if (!this.queue.length && !this.inFlight.size) this.emit();
  }

  private async load(i: number) {
    this.inFlight.add(i);
    this.status[i] = 'loading';
    try {
      const res = await fetch(this.urls[i], { signal: this.controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${this.urls[i]}`);
      const buf = await res.arrayBuffer();
      this.bytes += buf.byteLength;
      if (!isRegistered(this.imageIds[i])) await dicomImageLoader.prefetchPart10Instance(this.imageIds[i], buf);
      this.status[i] = 'done';
      this.resolve(i, true);
    } catch (e) {
      if (this.aborted) return;
      this.status[i] = 'failed';
      this.errors.set(i, e instanceof Error ? e.message : String(e));
      this.resolve(i, false);
    } finally {
      this.inFlight.delete(i);
      this.emit();
      this.pump();
    }
  }

  private resolve(i: number, ok: boolean) {
    for (const w of this.waiters.get(i) ?? []) w(ok);
    this.waiters.delete(i);
  }
}
