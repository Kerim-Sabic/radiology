/**
 * ProgressRepository: attempts, bookmarks, personal notes and reference reviews in
 * IndexedDB (this browser only). Versioned JSON export/import for backup or moving to
 * another device — local browser storage does not synchronise by itself.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { GradeResult, LearnerMark, PositionAtSubmit } from '../grading/types';
import type { ViewSnapshot } from '../viewer/engine';
import type { DrillStats } from './drill';
import { readingProgress } from '../book/readingProgress';

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

  async saveAttempt(a: Attempt) {
    try {
      await (await this.dbp).put('attempts', a);
      this.changed();
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
  async saveDrillStats(stats: DrillStats) {
    try {
      await (await this.dbp).put('meta', stats, 'drillStats');
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
      for (const a of (d.attempts as Attempt[]) ?? []) {
        const cur = await tx.objectStore('attempts').get(a.id);
        if (!cur || (a.submittedAt ?? '') >= (cur.submittedAt ?? '')) {
          await tx.objectStore('attempts').put(a);
          counts.attempts++;
        }
      }
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
    return counts;
  }

  async resetAll() {
    const db = await this.dbp;
    const tx = db.transaction(['attempts', 'bookmarks', 'notes', 'reviews', 'meta'], 'readwrite');
    await Promise.all([tx.objectStore('attempts').clear(), tx.objectStore('bookmarks').clear(), tx.objectStore('notes').clear(), tx.objectStore('reviews').clear(), tx.objectStore('meta').delete('drillStats')]);
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
