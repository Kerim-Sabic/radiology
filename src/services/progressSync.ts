/**
 * Keeps this browser and the signed-in account's saved study record in step (server/progressSync.ts).
 *
 * - Submitted attempts are queued in IndexedDB as they are saved (ProgressRepository.saveAttempt) and uploaded in
 *   small batches; the server keeps each attempt id once, so a retry or a double tap never adds a second grade.
 * - On sign-in, and when the app comes back into view, the account's log is read from where this browser left off
 *   and merged by attempt id. The first sign-in in a browser uploads the history already there, once.
 * - Offline or on a server error, the queue waits and is retried; the answers stay on this device meanwhile.
 *
 * The status is what the reading room shows: saved, saving, offline or failed (off when nobody is signed in).
 */
import { attemptVersion, SYNC_LIMITS, type PullResult, type PushResult } from '../../shared/progressSync';
import type { Attempt, ProgressRepository, SyncState } from './progressRepository';

export type SyncStatus = 'off' | 'saved' | 'saving' | 'offline' | 'failed';
export interface SyncSnapshot {
  status: SyncStatus;
  /** Submitted attempts waiting to be confirmed by the server. */
  pending: number;
  /** Attempts the server refused (they stay on this device). */
  refused: number;
  /** Why the last try failed, in plain words (failed only). */
  message: string | null;
  lastSyncedAt: string | null;
}

export interface SyncEnv {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  online: () => boolean;
  /** Listen for the browser's own signals (online, focus, visibility); returns a function that stops listening. */
  listen: ((sync: ProgressSync) => () => void) | null;
}

/** Bytes in one upload: below the server's limit, and small enough to finish on a slow phone connection. */
const UPLOAD_BYTES = 400_000;
/** Read the account's log again when the app comes back into view, at most this often. */
const PULL_EVERY_MS = 15_000;
/** And every few minutes while it stays open and visible. */
const POLL_MS = 5 * 60_000;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

function browserListen(sync: ProgressSync): () => void {
  const online = () => void sync.sync();
  const offline = () => sync.markOffline();
  const visible = () => {
    if (document.visibilityState === 'visible') void sync.pullSoon();
  };
  const timer = setInterval(() => document.visibilityState === 'visible' && void sync.sync(), POLL_MS);
  window.addEventListener('online', online);
  window.addEventListener('offline', offline);
  window.addEventListener('focus', visible);
  document.addEventListener('visibilitychange', visible);
  return () => {
    clearInterval(timer);
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
    window.removeEventListener('focus', visible);
    document.removeEventListener('visibilitychange', visible);
  };
}

export class ProgressSync {
  private account: string | null = null;
  private snap: SyncSnapshot = { status: 'off', pending: 0, refused: 0, message: null, lastSyncedAt: null };
  private listeners = new Set<() => void>();
  private chain: Promise<void> = Promise.resolve();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private lastPull = 0;
  private detach: (() => void) | null = null;
  private unqueue: (() => void) | null = null;
  private env: SyncEnv;

  constructor(
    private repo: ProgressRepository,
    env: Partial<SyncEnv> = {},
  ) {
    this.env = {
      fetch: env.fetch ?? ((input, init) => fetch(input, init)),
      online: env.online ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)),
      listen: env.listen === undefined ? (typeof window === 'undefined' ? null : browserListen) : env.listen,
    };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;
  private set(patch: Partial<SyncSnapshot>) {
    const next = { ...this.snap, ...patch };
    if (Object.keys(next).every((k) => next[k as keyof SyncSnapshot] === this.snap[k as keyof SyncSnapshot])) return;
    this.snap = next;
    for (const l of this.listeners) l();
  }

  /** Start keeping this browser in step with an account (its email). Resolves once the first sync has run. */
  start(email: string): Promise<void> {
    const account = email.trim().toLowerCase();
    if (this.account === account) return this.idle();
    this.stop();
    this.account = account;
    this.repo.setSyncAccount(account);
    this.unqueue = this.repo.onQueued(() => this.queued());
    this.detach = this.env.listen?.(this) ?? null;
    this.set({ status: this.env.online() ? 'saving' : 'offline', message: null });
    return this.run(async (acct) => {
      await this.repo.bootstrap(acct);
      await this.doPull(acct);
      await this.doFlush(acct);
    });
  }

  /** Signed out: stop syncing. What is queued stays queued for this account's next sign-in. */
  stop() {
    this.account = null;
    this.repo.setSyncAccount(null);
    this.unqueue?.();
    this.detach?.();
    this.unqueue = this.detach = null;
    for (const t of [this.flushTimer, this.retryTimer]) if (t) clearTimeout(t);
    this.flushTimer = this.retryTimer = null;
    this.failures = 0;
    this.set({ status: 'off', pending: 0, refused: 0, message: null });
  }

  /** Wait for the work already asked for. */
  idle(): Promise<void> {
    return this.chain;
  }

  /** Upload what is waiting, then read what other devices added. */
  sync(): Promise<void> {
    return this.run(async (acct) => {
      await this.doFlush(acct);
      await this.doPull(acct);
    });
  }

  /** Read the account's log, unless that was done a moment ago. */
  pullSoon(): Promise<void> {
    if (Date.now() - this.lastPull < PULL_EVERY_MS) return this.idle();
    return this.sync();
  }

  markOffline() {
    if (this.account) this.set({ status: 'offline' });
  }

  /**
   * Delete the account's saved record and this browser's progress (Progress → Reset). Signed in, the account's copy
   * goes first; if that fails nothing is deleted here either. Other devices clear theirs when they next sync.
   */
  async resetEverywhere(): Promise<void> {
    const account = this.account;
    if (!account) return this.repo.resetAll();
    await this.run(async () => {
      const r = await this.request<{ ok: true; gen: string }>('POST', '/api/progress/reset', {});
      await this.repo.resetAll();
      await this.repo.putSyncState(account, { pending: {}, cursor: 0, gen: r.gen, bootstrapped: true, refused: [], lastPulledAt: new Date().toISOString() });
      this.set({ status: 'saved', pending: 0, refused: 0, message: null });
    }, true);
  }

  private queued() {
    if (!this.account) return;
    this.set({ status: this.env.online() ? 'saving' : 'offline', pending: Math.max(1, this.snap.pending) });
    if (this.flushTimer) clearTimeout(this.flushTimer);
    // A short wait gathers a submit and the self-review ticks that follow it into one upload.
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.run((acct) => this.doFlush(acct));
    }, 600);
  }

  /** Run one piece of sync work after the others, for the account that asked for it. */
  private run(task: (account: string) => Promise<void>, rethrow = false): Promise<void> {
    const account = this.account;
    let error: unknown = null;
    this.chain = this.chain.then(async () => {
      if (!account || account !== this.account) return;
      try {
        await task(account);
        this.failures = 0;
      } catch (e) {
        error = e;
        if (account === this.account) this.fail(e);
      }
    });
    return rethrow ? this.chain.then(() => (error ? Promise.reject(error) : undefined)) : this.chain;
  }

  private fail(e: unknown) {
    this.failures++;
    const offline = !this.env.online() || e instanceof TypeError;
    const waiting = e instanceof HttpError && e.status === 429;
    this.set({
      status: offline ? 'offline' : waiting ? 'saving' : 'failed',
      message: offline ? null : e instanceof HttpError ? e.message : 'The server could not be reached.',
    });
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const delay = waiting ? 60_000 : Math.min(60_000, 2_000 * 2 ** Math.min(this.failures - 1, 5));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.sync();
    }, delay);
  }

  private async request<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
    const text = body === undefined ? undefined : JSON.stringify(body);
    const r = await this.env.fetch(url, {
      method,
      cache: 'no-store',
      headers: text ? { 'Content-Type': 'application/json' } : undefined,
      body: text,
    });
    const data = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!r.ok || !data) {
      const why = r.status === 401 ? 'You are signed out here. Your answers stay on this device and are saved to your account when you sign in again.' : (data?.error ?? `The server answered ${r.status}.`);
      throw new HttpError(r.status, why);
    }
    return data;
  }

  private async doFlush(account: string) {
    let state = await this.repo.syncState(account);
    const tried = new Set<string>();
    for (;;) {
      const ids = Object.keys(state.pending).filter((id) => !tried.has(id));
      if (!ids.length) break;
      if (!this.env.online()) throw new TypeError('offline');
      this.set({ status: 'saving', pending: Object.keys(state.pending).length });
      const found = await this.repo.attemptsByIds(ids.slice(0, SYNC_LIMITS.batch));
      const batch: Attempt[] = [];
      const versions: Record<string, string> = {};
      const gone: string[] = [];
      const tooLarge: string[] = [];
      let size = 0;
      for (const id of ids.slice(0, SYNC_LIMITS.batch)) {
        const a = found.get(id);
        tried.add(id);
        if (!a?.submittedAt) {
          gone.push(id);
          continue;
        }
        const json = JSON.stringify(a);
        // Larger than the server keeps (an outline with thousands of points): it stays on this device.
        if (json.length + 20 > SYNC_LIMITS.attemptChars) {
          tooLarge.push(id);
          continue;
        }
        const b = bytes(json);
        if (batch.length && size + b > UPLOAD_BYTES) {
          tried.delete(id);
          break;
        }
        batch.push(a);
        versions[id] = attemptVersion(a);
        size += b;
      }
      if (gone.length || tooLarge.length) state = await this.repo.ackUploaded(account, Object.fromEntries(gone.map((id) => [id, state.pending[id]])), tooLarge);
      if (!batch.length) continue;
      const r = await this.request<PushResult>('POST', '/api/progress/attempts', { attempts: batch });
      const confirmed: Record<string, string> = {};
      const refused: string[] = [];
      let full = false;
      batch.forEach((a, i) => {
        const code = r.codes[i];
        if (code === 'a' || code === 'm' || code === 'd') confirmed[a.id] = versions[a.id];
        else if (code === 'f') full = true;
        else refused.push(a.id);
      });
      state = await this.repo.ackUploaded(account, confirmed, refused, { start: r.start, end: r.end });
      if (full) throw new HttpError(507, 'Your account’s saved record is full. New answers stay on this device.');
    }
    this.settle(state);
  }

  private async doPull(account: string) {
    let state = await this.repo.syncState(account);
    for (let page = 0; page < 500; page++) {
      if (!this.env.online()) throw new TypeError('offline');
      const q = new URLSearchParams({ after: String(state.cursor) });
      if (state.gen !== undefined) q.set('gen', state.gen);
      const r = await this.request<PullResult<Attempt>>('GET', `/api/progress/attempts?${q}`);
      // Read before under another generation: the record was deleted elsewhere since.
      const reset = state.gen !== undefined && r.gen !== state.gen ? r.resetAt : false;
      ({ state } = await this.repo.mergeRemote(account, r, reset));
      if (r.next >= r.total || (!r.entries.length && reset === false)) break;
    }
    this.lastPull = Date.now();
    this.settle(state);
  }

  private settle(state: SyncState) {
    const pending = Object.keys(state.pending).length;
    this.set({ status: pending ? 'saving' : 'saved', pending, refused: state.refused.length, message: null, lastSyncedAt: new Date().toISOString() });
    if (pending && !this.flushTimer) this.queued();
  }
}
