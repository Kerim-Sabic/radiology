/**
 * ProgressRepository: attempts, bookmarks, personal notes and reference reviews in IndexedDB. Signed in, submitted
 * attempts are also saved to the account (services/progressSync.ts): each one is queued here in the same
 * transaction that stores it, so nothing committed is lost if the upload waits (offline, a closed tab, a server
 * error). Attempts from the account are merged in by id. Versioned JSON export/import remains for backups.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { attemptVersion, type LogEntry, type PullResult } from '../../shared/progressSync';
import type { GradeResult, LearnerMark, PositionAtSubmit } from '../grading/types';
import type { ViewSnapshot } from '../viewer/engine';
import type { DrillStats } from './drill';
import type { OncallShift } from './oncall';
import type { CertExam } from './exam';
import { readingProgress } from '../book/readingProgress';
import { logDrillAnswer, mergeLogs, type ActivityLog } from './activity';

export type Mode = 'learn' | 'practice' | 'assess' | 'review';

export interface WrittenReport {
  findings: string;
  impression: string;
  differential: string;
}

export interface Attempt {
  id: string;
  taskId: string;
  caseId: string;
  subjectKey: string;
  holdoutGroup: string;
  packId: string;
  lessonVersion: string;
  mode: Mode;
  startedAt: string;
  submittedAt: string | null;
  durationMs: number;
  marks: LearnerMark[];
  position: PositionAtSubmit | null;
  choice: string[];
  declaredNoFinding: boolean;
  uncertain: boolean;
  report: WrittenReport | null;
  confidence: number | null; // 1..5
  hintsUsed: number[]; // hint levels opened
  revealed: boolean;
  /** Legacy field from exports made while the app had an AI tutor. */
  tutorUsed?: boolean;
  grade: GradeResult | null;
  selfReview: { checked: string[]; verdict: 'correct' | 'partial' | 'incorrect' | null } | null;
  /** When the self-review was last changed (after submitting); it never moves submittedAt. */
  reviewedAt?: string | null;
  /** True only when submitted without hints or reveal. */
  independent: boolean;
  objectiveIds: string[];
  skillDimensions: string[];
}

export interface Bookmark {
  id: string;
  caseId: string;
  label: string;
  createdAt: string;
  snapshot: ViewSnapshot;
}

export interface Note {
  id: string;
  scope: 'case' | 'target' | 'task' | 'page';
  refId: string;
  kind: 'note' | 'dispute' | 'correction';
  text: string;
  createdAt: string;
}

export interface TargetReview {
  targetId: string;
  status: 'reviewed_by_user' | 'disputed';
  reviewer: string;
  at: string;
  note: string;
  /** Optional personal adjustment (e.g. accepted slice interval). Original reference is preserved. */
  adjustment?: { sliceRangeMm?: [number, number] } | null;
}

interface RvmDB extends DBSchema {
  attempts: { key: string; value: Attempt; indexes: { byTask: string; byCase: string; bySubmitted: string } };
  bookmarks: { key: string; value: Bookmark; indexes: { byCase: string } };
  notes: { key: string; value: Note; indexes: { byRef: string } };
  reviews: { key: string; value: TargetReview };
  meta: { key: string; value: unknown };
}

/**
 * What this browser knows about one account's saved record (kept in `meta` under `sync:<account>`).
 * `pending`: submitted attempts not yet confirmed by the server (id → version); `cursor`: how far this browser has
 * read the account's log; `gen`: the log generation it read (undefined until the first read).
 */
export interface SyncState {
  pending: Record<string, string>;
  cursor: number;
  gen?: string;
  bootstrapped: boolean;
  /** Attempts the server refused (too large, malformed): they stay on this device only. */
  refused: string[];
  lastPulledAt: string | null;
}
const syncKey = (account: string) => `sync:${account}`;
function readSyncState(value: unknown): SyncState {
  const v = (value ?? {}) as Partial<SyncState>;
  return { pending: { ...(v.pending ?? {}) }, cursor: v.cursor ?? 0, gen: v.gen, bootstrapped: !!v.bootstrapped, refused: [...(v.refused ?? [])], lastPulledAt: v.lastPulledAt ?? null };
}

/**
 * How an attempt from the account combines with this browser's copy of the same id. A submitted attempt beats a
 * draft; between two submitted copies (the same answer, as attempt ids are made on one device) the newer
 * self-review wins. A review entry only ever changes the verdict, never the answer or its grade.
 */
export function mergeEntry(local: Attempt | undefined, entry: LogEntry<Attempt>): Attempt | null {
  if (entry.t === 'c') {
    const remote = entry.a;
    if (!local || !local.submittedAt) return remote;
    return attemptVersion(remote) > attemptVersion(local) ? { ...local, selfReview: remote.selfReview, reviewedAt: remote.reviewedAt ?? null } : null;
  }
  if (!local?.submittedAt || entry.at <= attemptVersion(local)) return null;
  return { ...local, selfReview: entry.r, reviewedAt: entry.at };
}

const DB_NAME = 'radiology-visual-mastery';
const DB_VERSION = 1;
export const EXPORT_FORMAT = 'rvm-progress';
export const EXPORT_VERSION = 1;

export class StorageError extends Error {
  constructor(
    message: string,
    readonly quota = false,
  ) {
    super(message);
  }
}

function wrap(e: unknown): never {
  const name = (e as { name?: string })?.name;
  if (name === 'QuotaExceededError') throw new StorageError('Browser storage is full. Export your progress, then clear cached data packs in Settings.', true);
  throw new StorageError(`Could not save progress: ${e instanceof Error ? e.message : String(e)}`);
}

export class ProgressRepository {
  private dbp: Promise<IDBPDatabase<RvmDB>>;
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(name = DB_NAME) {
    this.dbp = openDB<RvmDB>(name, DB_VERSION, {
      upgrade(db) {
        const a = db.createObjectStore('attempts', { keyPath: 'id' });
        a.createIndex('byTask', 'taskId');
        a.createIndex('byCase', 'caseId');
        a.createIndex('bySubmitted', 'submittedAt');
        db.createObjectStore('bookmarks', { keyPath: 'id' }).createIndex('byCase', 'caseId');
        db.createObjectStore('notes', { keyPath: 'id' }).createIndex('byRef', 'refId');
        db.createObjectStore('reviews', { keyPath: 'targetId' });
        db.createObjectStore('meta');
      },
    });
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  private changed() {
    this.version++;
    for (const l of this.listeners) l();
  }

  // ------------------------------------------------------------- the account's saved record
  private syncAccount: string | null = null;
  private queueListeners = new Set<() => void>();
  /** The signed-in account whose upload queue new submitted attempts join (null: not signed in, nothing is queued). */
  setSyncAccount(account: string | null) {
    this.syncAccount = account;
  }
  /** Called after a submitted attempt has been queued for upload. */
  onQueued(fn: () => void) {
    this.queueListeners.add(fn);
    return () => void this.queueListeners.delete(fn);
  }
  private queued() {
    for (const l of this.queueListeners) l();
  }
  async syncState(account: string): Promise<SyncState> {
    return readSyncState(await (await this.dbp).get('meta', syncKey(account)));
  }
  async putSyncState(account: string, state: SyncState) {
    await (await this.dbp).put('meta', state, syncKey(account));
  }

  /**
   * The first time an account syncs in this browser, queue the attempts already here, once. Only the first account
   * to sync in this browser takes them: another account signing in later starts from its own record.
   */
  async bootstrap(account: string): Promise<number> {
    const tx = (await this.dbp).transaction(['attempts', 'meta'], 'readwrite');
    const meta = tx.objectStore('meta');
    const state = readSyncState(await meta.get(syncKey(account)));
    if (state.bootstrapped) {
      await tx.done;
      return 0;
    }
    const owner = (await meta.get('syncOwner')) as string | undefined;
    if (!owner) await meta.put(account, 'syncOwner');
    let n = 0;
    if (!owner || owner === account)
      for (const a of await tx.objectStore('attempts').getAll())
        if (a.submittedAt && !state.pending[a.id]) {
          state.pending[a.id] = attemptVersion(a);
          n++;
        }
    state.bootstrapped = true;
    await meta.put(state, syncKey(account));
    await tx.done;
    return n;
  }

  async attemptsByIds(ids: string[]): Promise<Map<string, Attempt>> {
    const tx = (await this.dbp).transaction('attempts');
    const found = await Promise.all(ids.map((id) => tx.store.get(id)));
    await tx.done;
    return new Map(found.filter((a): a is Attempt => !!a).map((a) => [a.id, a]));
  }

  /**
   * After an upload: drop what the server confirmed (unless the attempt changed meanwhile), set aside what it
   * refused, and skip this upload's own entries in the log when nothing else came in between.
   */
  async ackUploaded(account: string, confirmed: Record<string, string>, refused: string[], log?: { start: number; end: number }): Promise<SyncState> {
    const tx = (await this.dbp).transaction('meta', 'readwrite');
    const state = readSyncState(await tx.store.get(syncKey(account)));
    for (const [id, version] of Object.entries(confirmed)) if (state.pending[id] === version) delete state.pending[id];
    for (const id of refused) {
      delete state.pending[id];
      if (!state.refused.includes(id)) state.refused = [...state.refused, id].slice(-200);
    }
    if (log && state.gen !== undefined && state.cursor === log.start) state.cursor = log.end;
    await tx.store.put(state, syncKey(account));
    await tx.done;
    return state;
  }

  /**
   * Merge one page of the account's log into this browser. `resetAt`: the record was deleted on another device
   * since this browser last read it, so its submitted attempts up to then go too (unless still waiting to upload).
   */
  async mergeRemote(account: string, page: PullResult<Attempt>, resetAt: string | null | false): Promise<{ state: SyncState; changed: number }> {
    const tx = (await this.dbp).transaction(['attempts', 'meta'], 'readwrite');
    const store = tx.objectStore('attempts');
    const meta = tx.objectStore('meta');
    const state = readSyncState(await meta.get(syncKey(account)));
    let changed = 0;
    try {
      if (resetAt !== false) {
        for (const a of await store.getAll())
          if (a.submittedAt && !state.pending[a.id] && (resetAt === null || attemptVersion(a) <= resetAt)) {
            await store.delete(a.id);
            changed++;
          }
        state.cursor = 0;
      }
      for (const entry of page.entries) {
        const id = entry.t === 'c' ? entry.a.id : entry.id;
        const next = mergeEntry(await store.get(id), entry);
        if (next) {
          await store.put(next);
          changed++;
        }
      }
      state.cursor = page.next;
      state.gen = page.gen;
      state.lastPulledAt = new Date().toISOString();
      await meta.put(state, syncKey(account));
      await tx.done;
    } catch (e) {
      wrap(e);
    }
    if (changed) this.changed();
    return { state, changed };
  }

  async saveAttempt(a: Attempt) {
    const account = a.submittedAt ? this.syncAccount : null;
    try {
      if (!account) await (await this.dbp).put('attempts', a);
      else {
        // The attempt and its place in the upload queue are written together, so a committed answer is never left unsent.
        const tx = (await this.dbp).transaction(['attempts', 'meta'], 'readwrite');
        await tx.objectStore('attempts').put(a);
        const state = readSyncState(await tx.objectStore('meta').get(syncKey(account)));
        state.pending[a.id] = attemptVersion(a);
        await tx.objectStore('meta').put(state, syncKey(account));
        await tx.done;
      }
      this.changed();
      if (account) this.queued();
    } catch (e) {
      wrap(e);
    }
  }
  async attempts(): Promise<Attempt[]> {
    return (await this.dbp).getAll('attempts');
  }
  async attemptsForTask(taskId: string) {
    return (await this.dbp).getAllFromIndex('attempts', 'byTask', taskId);
  }
  async deleteAttempt(id: string) {
    await (await this.dbp).delete('attempts', id);
    this.changed();
  }

  async saveBookmark(b: Bookmark) {
    try {
      await (await this.dbp).put('bookmarks', b);
      this.changed();
    } catch (e) {
      wrap(e);
    }
  }
  async bookmarks(caseId?: string) {
    const db = await this.dbp;
    return caseId ? db.getAllFromIndex('bookmarks', 'byCase', caseId) : db.getAll('bookmarks');
  }
  async deleteBookmark(id: string) {
    await (await this.dbp).delete('bookmarks', id);
    this.changed();
  }

  async saveNote(n: Note) {
    try {
      await (await this.dbp).put('notes', n);
      this.changed();
    } catch (e) {
      wrap(e);
    }
  }
  async notes(refId?: string) {
    const db = await this.dbp;
    return refId ? db.getAllFromIndex('notes', 'byRef', refId) : db.getAll('notes');
  }
  async deleteNote(id: string) {
    await (await this.dbp).delete('notes', id);
    this.changed();
  }

  async saveReview(r: TargetReview) {
    try {
      await (await this.dbp).put('reviews', r);
      this.changed();
    } catch (e) {
      wrap(e);
    }
  }
  async reviews() {
    return (await this.dbp).getAll('reviews');
  }
  async deleteReview(targetId: string) {
    await (await this.dbp).delete('reviews', targetId);
    this.changed();
  }

  /** Anatomy-drill spaced-repetition state, one record per structure. */
  async drillStats(): Promise<DrillStats> {
    return ((await (await this.dbp).get('meta', 'drillStats')) as DrillStats | undefined) ?? {};
  }
  /** Drill answers per day (submitted answers are counted from the attempts themselves). */
  async activityLog(): Promise<ActivityLog> {
    return ((await (await this.dbp).get('meta', 'activity')) as ActivityLog | undefined) ?? {};
  }
  /** The on-call shift in progress (or the last one, once finished). */
  async oncallShift(): Promise<OncallShift | null> {
    return ((await (await this.dbp).get('meta', 'oncallShift')) as OncallShift | undefined) ?? null;
  }
  async saveOncallShift(shift: OncallShift) {
    try {
      await (await this.dbp).put('meta', shift, 'oncallShift');
      this.changed();
    } catch (e) {
      wrap(e);
    }
  }
  /** Finished shifts, newest first (the last 30). */
  async oncallHistory(): Promise<OncallShift[]> {
    return ((await (await this.dbp).get('meta', 'oncallHistory')) as OncallShift[] | undefined) ?? [];
  }
  async finishOncallShift(shift: OncallShift) {
    const done = { ...shift, finishedAt: shift.finishedAt ?? new Date().toISOString() };
    try {
      const db = await this.dbp;
      const history = (((await db.get('meta', 'oncallHistory')) as OncallShift[] | undefined) ?? []).filter((s) => s.id !== done.id);
      await db.put('meta', [done, ...history].slice(0, 30), 'oncallHistory');
      await db.put('meta', done, 'oncallShift');
      this.changed();
    } catch (e) {
      wrap(e);
    }
    return done;
  }
  /** A certification exam by id: the one in progress or a finished one. */
  async certExam(id: string): Promise<CertExam | null> {
    const db = await this.dbp;
    const current = (await db.get('meta', 'certExam')) as CertExam | undefined;
    if (current?.id === id) return current;
    return (((await db.get('meta', 'certExamHistory')) as CertExam[] | undefined) ?? []).find((e) => e.id === id) ?? null;
  }
  /** The exam in progress (or the last one, once finished). */
  async currentCertExam(): Promise<CertExam | null> {
    return ((await (await this.dbp).get('meta', 'certExam')) as CertExam | undefined) ?? null;
  }
  async saveCertExam(exam: CertExam) {
    try {
      await (await this.dbp).put('meta', exam, 'certExam');
      this.changed();
    } catch (e) {
      wrap(e);
    }
  }
  /** Finished exams, newest first (the last 50). */
  async certExamHistory(): Promise<CertExam[]> {
    return ((await (await this.dbp).get('meta', 'certExamHistory')) as CertExam[] | undefined) ?? [];
  }
  async finishCertExam(exam: CertExam) {
    const done = { ...exam, finishedAt: exam.finishedAt ?? new Date().toISOString() };
    try {
      const db = await this.dbp;
      const history = (((await db.get('meta', 'certExamHistory')) as CertExam[] | undefined) ?? []).filter((e) => e.id !== done.id);
      await db.put('meta', [done, ...history].slice(0, 50), 'certExamHistory');
      await db.put('meta', done, 'certExam');
      this.changed();
    } catch (e) {
      wrap(e);
    }
    return done;
  }
  /** Saves drill state after an answer; the answer also counts toward that day's study activity. */
  async saveDrillStats(stats: DrillStats, answeredAt: Date | null = new Date()) {
    try {
      const tx = (await this.dbp).transaction('meta', 'readwrite');
      await tx.store.put(stats, 'drillStats');
      if (answeredAt) await tx.store.put(logDrillAnswer(((await tx.store.get('activity')) as ActivityLog | undefined) ?? {}, answeredAt), 'activity');
      await tx.done;
      this.changed();
    } catch (e) {
      wrap(e);
    }
  }

  async exportAll() {
    const db = await this.dbp;
    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      app: 'radiology-visual-mastery',
      attempts: await db.getAll('attempts'),
      bookmarks: await db.getAll('bookmarks'),
      notes: await db.getAll('notes'),
      reviews: await db.getAll('reviews'),
      drillStats: ((await db.get('meta', 'drillStats')) as DrillStats | undefined) ?? {},
      activity: ((await db.get('meta', 'activity')) as ActivityLog | undefined) ?? {},
      bookPagesRead: [...readingProgress.pages()],
    };
  }

  /** Merge an export; existing records with the same id are replaced only by newer copies. */
  async importAll(data: unknown): Promise<{ attempts: number; bookmarks: number; notes: number; reviews: number }> {
    const d = data as Record<string, unknown>;
    if (!d || d.format !== EXPORT_FORMAT) throw new StorageError('Not a radiology.monster progress export.');
    if (typeof d.version !== 'number' || d.version > EXPORT_VERSION) throw new StorageError(`Unsupported export version ${String(d.version)}.`);
    const db = await this.dbp;
    const counts = { attempts: 0, bookmarks: 0, notes: 0, reviews: 0 };
    try {
      const tx = db.transaction(['attempts', 'bookmarks', 'notes', 'reviews', 'meta'], 'readwrite');
      const drill = { ...(((await tx.objectStore('meta').get('drillStats')) as DrillStats | undefined) ?? {}) };
      for (const st of Object.values((d.drillStats as DrillStats) ?? {})) if (!drill[st.key] || st.lastAt >= drill[st.key].lastAt) drill[st.key] = st;
      await tx.objectStore('meta').put(drill, 'drillStats');
      if (d.activity && typeof d.activity === 'object')
        await tx.objectStore('meta').put(mergeLogs(((await tx.objectStore('meta').get('activity')) as ActivityLog | undefined) ?? {}, d.activity as ActivityLog), 'activity');
      const account = this.syncAccount;
      const sync = account ? readSyncState(await tx.objectStore('meta').get(syncKey(account))) : null;
      for (const a of (d.attempts as Attempt[]) ?? []) {
        const cur = await tx.objectStore('attempts').get(a.id);
        if (!cur || (a.submittedAt ?? '') >= (cur.submittedAt ?? '')) {
          await tx.objectStore('attempts').put(a);
          counts.attempts++;
          // Signed in: imported answers are saved to the account too (the server keeps each id once).
          if (sync && a.submittedAt) sync.pending[a.id] = attemptVersion(a);
        }
      }
      if (account && sync) await tx.objectStore('meta').put(sync, syncKey(account));
      for (const b of (d.bookmarks as Bookmark[]) ?? []) {
        await tx.objectStore('bookmarks').put(b);
        counts.bookmarks++;
      }
      for (const n of (d.notes as Note[]) ?? []) {
        await tx.objectStore('notes').put(n);
        counts.notes++;
      }
      for (const r of (d.reviews as TargetReview[]) ?? []) {
        const cur = await tx.objectStore('reviews').get(r.targetId);
        if (!cur || r.at >= cur.at) {
          await tx.objectStore('reviews').put(r);
          counts.reviews++;
        }
      }
      await tx.done;
    } catch (e) {
      wrap(e);
    }
    readingProgress.merge(d.bookPagesRead);
    this.changed();
    if (this.syncAccount && counts.attempts) this.queued();
    return counts;
  }

  async resetAll() {
    const db = await this.dbp;
    const tx = db.transaction(['attempts', 'bookmarks', 'notes', 'reviews', 'meta'], 'readwrite');
    await Promise.all([tx.objectStore('attempts').clear(), tx.objectStore('bookmarks').clear(), tx.objectStore('notes').clear(), tx.objectStore('reviews').clear(), tx.objectStore('meta').delete('drillStats'), tx.objectStore('meta').delete('oncallShift'), tx.objectStore('meta').delete('oncallHistory'), tx.objectStore('meta').delete('certExam'), tx.objectStore('meta').delete('certExamHistory'), tx.objectStore('meta').delete('activity')]);
    await tx.done;
    readingProgress.clear();
    this.changed();
  }

  async estimate() {
    try {
      return await navigator.storage?.estimate?.();
    } catch {
      return undefined;
    }
  }
}

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
