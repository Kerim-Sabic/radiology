/**
 * The account's saved study record: the server's append-only log (its real Lua script, run by tests/fakeRedis.ts)
 * and the browser side (IndexedDB queue, merge, offline and retries) with two "devices" sharing one account.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRedis } from './fakeRedis';

const redis = vi.hoisted(() => ({ current: null as null | { client(): unknown } }));
vi.mock('../server/store', () => ({ db: () => redis.current!.client(), rateLimit: async () => true }));

import { pullAttempts, pushAttempts, resetAttempts } from '../server/progressSync';
import { mergeEntry, ProgressRepository, type Attempt } from '../src/services/progressRepository';
import { ProgressSync } from '../src/services/progressSync';
import { SYNC_LIMITS } from '../shared/progressSync';
import type { GradeResult } from '../src/grading/types';

const fake = new FakeRedis();
redis.current = fake;
const UID = 'u'.repeat(64);

const grade = (outcome: GradeResult['outcome']) => ({ gradingKind: 'point', authoritative: true, authorityNote: '', outcome, score: outcome === 'correct' ? 1 : 0, components: {}, targets: [], marks: [], errors: [], messages: [] }) as GradeResult;
let seq = 0;
function attempt(over: Partial<Attempt> = {}): Attempt {
  seq++;
  return {
    id: `att-${seq}`,
    taskId: 'starter-ct-chest-01:heart',
    caseId: 'starter-ct-chest-01',
    subjectKey: 'lctsc-s1-012',
    holdoutGroup: 'lctsc-s1-012',
    packId: 'starter',
    lessonVersion: '1',
    mode: 'practice',
    startedAt: '2026-01-04T10:00:00.000Z',
    submittedAt: `2026-01-04T10:${String(seq % 60).padStart(2, '0')}:00.000Z`,
    durationMs: 60_000,
    marks: [],
    position: null,
    choice: [],
    declaredNoFinding: false,
    uncertain: false,
    report: null,
    confidence: 4,
    hintsUsed: [],
    revealed: false,
    grade: grade('correct'),
    selfReview: null,
    independent: true,
    objectiveIds: [],
    skillDimensions: ['localization'],
    ...over,
  };
}
const push = (attempts: unknown[], uid = UID) => pushAttempts(uid, JSON.stringify({ attempts }));
const log = (uid = UID) => fake.lists.get(`rvm:progress:${uid}:log`) ?? [];

beforeEach(() => fake.clear());

describe('server: the append-only log', () => {
  it('keeps each attempt id once: retries, refreshes and double taps add nothing', async () => {
    const a = attempt();
    expect(await push([a])).toMatchObject({ ok: true, codes: 'a', start: 0, end: 1 });
    expect(await push([a])).toMatchObject({ ok: true, codes: 'd', start: 1, end: 1 });
    // A double tap inside one upload, and a different copy of the same id (a changed grade is not a new answer).
    const b = attempt();
    expect(await push([b, b, { ...a, grade: grade('incorrect') }])).toMatchObject({ codes: 'add', start: 1, end: 2 });
    expect(log()).toHaveLength(2);
    const page = await pullAttempts(UID, 0, null);
    expect(page.entries.map((e) => (e.t === 'c' ? e.a.id : e.id))).toEqual([a.id, b.id]);
    expect((page.entries[0] as unknown as { a: Attempt }).a.grade?.outcome).toBe('correct');
  });

  it('a newer self-review adds only the verdict; an older copy adds nothing', async () => {
    const a = attempt({ grade: grade('self_review') });
    await push([a]);
    const reviewed = { ...a, grade: grade('correct'), selfReview: { checked: ['apex'], verdict: 'partial' as const }, reviewedAt: '2026-01-04T11:00:00.000Z' };
    expect(await push([reviewed])).toMatchObject({ codes: 'm' });
    expect(await push([reviewed])).toMatchObject({ codes: 'd' });
    const page = await pullAttempts(UID, 0, null);
    expect(page.entries).toHaveLength(2);
    expect(page.entries[1]).toEqual({ t: 'r', id: a.id, at: '2026-01-04T11:00:00.000Z', r: { checked: ['apex'], verdict: 'partial' } });
    expect(await push([{ ...reviewed, selfReview: { checked: [], verdict: 'incorrect' }, reviewedAt: '2026-01-04T10:30:00.000Z' }])).toMatchObject({ codes: 'd' });
  });

  it('refuses drafts and malformed attempts without storing them', async () => {
    const r = await push([attempt({ submittedAt: null }), attempt({ id: 'has spaces' }), { id: 'x' }, attempt({ submittedAt: 'yesterday' }), attempt()]);
    expect(r).toMatchObject({ ok: true, codes: 'xxxxa' });
    expect(log()).toHaveLength(1);
    expect(await pushAttempts(UID, '{')).toMatchObject({ ok: false, status: 400 });
    expect(await push([])).toMatchObject({ ok: false, status: 400 });
    expect(await push(Array.from({ length: SYNC_LIMITS.batch + 1 }, () => attempt()))).toMatchObject({ ok: false, status: 400 });
    expect(await pushAttempts(UID, 'x'.repeat(SYNC_LIMITS.bodyChars + 1))).toMatchObject({ ok: false, status: 413 });
    expect(await push([attempt({ report: { findings: 'x'.repeat(SYNC_LIMITS.attemptChars), impression: '', differential: '' } })])).toMatchObject({ codes: 'x' });
  });

  it('stops at the account limit instead of storing more', async () => {
    fake.strings.set(`rvm:progress:${UID}:bytes`, String(SYNC_LIMITS.maxBytes - 10));
    expect(await push([attempt()])).toMatchObject({ ok: true, codes: 'f', start: 0, end: 0 });
    expect(log()).toHaveLength(0);
  });

  it('keeps accounts apart', async () => {
    await push([attempt()]);
    expect((await pullAttempts('v'.repeat(64), 0, null)).entries).toEqual([]);
  });

  it('reads in pages, and starts again from the beginning after a reset', async () => {
    for (let i = 0; i < 3; i++) await push([attempt(), attempt()]);
    const first = await pullAttempts(UID, 0, null);
    expect(first).toMatchObject({ gen: '', resetAt: null, from: 0, next: 6, total: 6 });
    expect((await pullAttempts(UID, 4, '')).entries).toHaveLength(2);
    const reset = await resetAttempts(UID);
    expect(log()).toHaveLength(0);
    await push([attempt()]);
    // A browser that read 6 entries before the reset is told the new generation and reads from 0.
    const after = await pullAttempts(UID, 6, '');
    expect(after).toMatchObject({ gen: reset.gen, resetAt: reset.resetAt, from: 0, next: 1, total: 1 });
    expect(after.entries).toHaveLength(1);
  });
});

describe('browser: merging an entry from the account', () => {
  const a = attempt();
  it('a submitted attempt beats a missing copy or a draft, never another submitted copy', () => {
    expect(mergeEntry(undefined, { t: 'c', a })).toEqual(a);
    expect(mergeEntry({ ...a, submittedAt: null }, { t: 'c', a })).toEqual(a);
    expect(mergeEntry(a, { t: 'c', a: { ...a, grade: grade('incorrect') } })).toBeNull();
  });
  it('a self-review is taken only when newer, and keeps the answer and its grade', () => {
    const r = { checked: ['x'], verdict: 'correct' as const };
    const merged = mergeEntry(a, { t: 'r', id: a.id, at: '2026-01-05T00:00:00.000Z', r });
    expect(merged).toEqual({ ...a, selfReview: r, reviewedAt: '2026-01-05T00:00:00.000Z' });
    expect(mergeEntry(merged!, { t: 'r', id: a.id, at: '2026-01-04T23:00:00.000Z', r: null })).toBeNull();
    expect(mergeEntry(undefined, { t: 'r', id: a.id, at: '2026-01-05T00:00:00.000Z', r })).toBeNull();
  });
});

describe('browser: two devices, one account', () => {
  const net = { down: false, fail: 0, loseResponse: false, calls: [] as string[] };
  let n = 0;
  const syncs: ProgressSync[] = [];
  /** The app's fetch, answered by the real server functions for one signed-in account. */
  async function api(url: string, init?: RequestInit): Promise<Response> {
    const method = init?.method ?? 'GET';
    net.calls.push(`${method} ${url}`);
    if (net.down) throw new TypeError('Failed to fetch');
    if (net.fail > 0) {
      net.fail--;
      return Response.json({ error: 'We could not verify your account.' }, { status: 503 });
    }
    const u = new URL(url, 'https://www.radiology.monster');
    let body: unknown;
    let status = 200;
    if (u.pathname === '/api/progress/attempts' && method === 'POST') {
      const r = await pushAttempts(UID, String(init?.body));
      [body, status] = r.ok ? [r, 200] : [{ error: r.error }, r.status];
    } else if (u.pathname === '/api/progress/attempts') body = await pullAttempts(UID, Number(u.searchParams.get('after')), u.searchParams.get('gen'));
    else if (u.pathname === '/api/progress/reset') body = await resetAttempts(UID);
    else [body, status] = [{ error: 'Not found' }, 404];
    // The server did the work, but the answer never reached the browser.
    if (net.loseResponse) {
      net.loseResponse = false;
      throw new TypeError('Failed to fetch');
    }
    return Response.json(body, { status });
  }
  function device() {
    const repo = new ProgressRepository(`sync-test-${++n}`);
    const sync = new ProgressSync(repo, { fetch: api, online: () => !net.down, listen: null });
    syncs.push(sync);
    return { repo, sync };
  }
  const committed = async (repo: ProgressRepository) => (await repo.attempts()).filter((a) => a.submittedAt);

  beforeEach(() => Object.assign(net, { down: false, fail: 0, loseResponse: false, calls: [] }));
  afterEach(() => {
    for (const s of syncs.splice(0)) s.stop();
  });

  it('an attempt made on one device appears on the other after sign-in, once', async () => {
    const A = device();
    await A.sync.start('Member@Example.com');
    const a = attempt();
    await A.repo.saveAttempt(a);
    expect(A.sync.getSnapshot().status).toBe('saving');
    await A.sync.sync();
    expect(A.sync.getSnapshot()).toMatchObject({ status: 'saved', pending: 0 });

    const B = device();
    await B.sync.start('member@example.com');
    expect(await committed(B.repo)).toEqual([a]);
    // Signing in again, refreshing, syncing twice: still one attempt, and one entry in the account.
    await B.sync.sync();
    await B.sync.sync();
    await A.sync.sync();
    expect(await committed(B.repo)).toHaveLength(1);
    expect(await committed(A.repo)).toHaveLength(1);
    expect(log()).toHaveLength(1);

    // And back: B's answer reaches A, A's own upload is not read back.
    const b = attempt();
    await B.repo.saveAttempt(b);
    await B.sync.sync();
    net.calls = [];
    await A.sync.sync();
    expect((await committed(A.repo)).map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(log()).toHaveLength(2);
  });

  it('drafts stay on the device', async () => {
    const A = device();
    await A.sync.start('member@example.com');
    await A.repo.saveAttempt(attempt({ submittedAt: null }));
    await A.sync.sync();
    expect(log()).toHaveLength(0);
  });

  it('the first sign-in in a browser uploads the history already there, once', async () => {
    const A = device();
    const old = [attempt(), attempt(), attempt()];
    for (const a of old) await A.repo.saveAttempt(a);
    await A.repo.saveAttempt(attempt({ submittedAt: null }));
    await A.sync.start('member@example.com');
    expect(log()).toHaveLength(3);
    expect(net.calls.filter((c) => c.startsWith('POST'))).toHaveLength(1);

    // The next session in this browser (a new page load) does not upload it again.
    A.sync.stop();
    net.calls = [];
    const again = new ProgressSync(A.repo, { fetch: api, online: () => !net.down, listen: null });
    syncs.push(again);
    await again.start('member@example.com');
    expect(net.calls.filter((c) => c.startsWith('POST'))).toEqual([]);
    expect(log()).toHaveLength(3);
    expect(again.getSnapshot().status).toBe('saved');
  });

  it('another account signing in on the same browser does not take its history', async () => {
    const A = device();
    await A.repo.saveAttempt(attempt());
    await A.sync.start('first@example.com');
    A.sync.stop();
    fake.clear();
    await A.sync.start('second@example.com');
    expect(log()).toHaveLength(0);
  });

  it('offline: the answer is kept and queued, then saved once back online', async () => {
    const A = device();
    await A.sync.start('member@example.com');
    net.down = true;
    const a = attempt();
    await A.repo.saveAttempt(a);
    expect(A.sync.getSnapshot().status).toBe('offline');
    await A.sync.sync();
    expect(A.sync.getSnapshot()).toMatchObject({ status: 'offline', pending: 1 });
    expect(await committed(A.repo)).toEqual([a]);
    expect(log()).toHaveLength(0);

    net.down = false;
    await A.sync.sync();
    expect(A.sync.getSnapshot()).toMatchObject({ status: 'saved', pending: 0 });
    expect(log()).toHaveLength(1);
  });

  it('a lost response is retried without a second grade', async () => {
    const A = device();
    await A.sync.start('member@example.com');
    await A.repo.saveAttempt(attempt());
    net.loseResponse = true;
    await A.sync.sync();
    expect(A.sync.getSnapshot()).toMatchObject({ status: 'offline', pending: 1 });
    expect(log()).toHaveLength(1);
    await A.sync.sync();
    expect(A.sync.getSnapshot()).toMatchObject({ status: 'saved', pending: 0 });
    expect(log()).toHaveLength(1);
  });

  it('a server error shows as failed, keeps the answer, and is retried', async () => {
    const A = device();
    await A.sync.start('member@example.com');
    await A.repo.saveAttempt(attempt());
    net.fail = 1;
    await A.sync.sync();
    expect(A.sync.getSnapshot()).toMatchObject({ status: 'failed', pending: 1, message: 'We could not verify your account.' });
    await A.sync.sync();
    expect(A.sync.getSnapshot()).toMatchObject({ status: 'saved', pending: 0 });
    expect(log()).toHaveLength(1);
  });

  it('a later self-review reaches the other device as a verdict, keeping the answer', async () => {
    const A = device();
    await A.sync.start('member@example.com');
    const a = attempt({ grade: grade('self_review') });
    await A.repo.saveAttempt(a);
    await A.sync.sync();
    const B = device();
    await B.sync.start('member@example.com');
    await A.repo.saveAttempt({ ...a, selfReview: { checked: ['apex'], verdict: 'correct' }, reviewedAt: '2026-01-04T12:00:00.000Z' });
    await A.sync.sync();
    await B.sync.sync();
    expect(await committed(B.repo)).toEqual([{ ...a, selfReview: { checked: ['apex'], verdict: 'correct' }, reviewedAt: '2026-01-04T12:00:00.000Z' }]);
    expect(log()).toHaveLength(2);
  });

  it('a backup imported while signed in is saved to the account', async () => {
    const A = device();
    await A.sync.start('member@example.com');
    const backup = { format: 'rvm-progress', version: 1, attempts: [attempt(), attempt()], bookmarks: [], notes: [], reviews: [] };
    await A.repo.importAll(backup);
    await A.sync.sync();
    expect(log()).toHaveLength(2);
  });

  it('Reset deletes the account copy, and other devices clear theirs when they sync', async () => {
    const A = device();
    const B = device();
    await A.sync.start('member@example.com');
    await A.repo.saveAttempt(attempt());
    await A.sync.sync();
    await B.sync.start('member@example.com');
    expect(await committed(B.repo)).toHaveLength(1);

    await A.sync.resetEverywhere();
    expect(await committed(A.repo)).toEqual([]);
    expect(log()).toHaveLength(0);
    await B.sync.sync();
    expect(await committed(B.repo)).toEqual([]);

    // Study goes on after the reset, in step again.
    const c = attempt({ submittedAt: new Date(Date.now() + 60_000).toISOString() });
    await B.repo.saveAttempt(c);
    await B.sync.sync();
    await A.sync.sync();
    expect(await committed(A.repo)).toEqual([c]);
  });

  it('Reset deletes nothing when the account cannot be reached', async () => {
    const A = device();
    await A.sync.start('member@example.com');
    await A.repo.saveAttempt(attempt());
    await A.sync.sync();
    net.down = true;
    await expect(A.sync.resetEverywhere()).rejects.toThrow();
    expect(await committed(A.repo)).toHaveLength(1);
    expect(log()).toHaveLength(1);
  });
});
