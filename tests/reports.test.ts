import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// An in-memory stand-in for the Redis list and set the reports use.
const fake = vi.hoisted(() => ({ lists: new Map<string, string[]>(), sets: new Map<string, Set<string>>() }));
vi.mock('../server/store', () => {
  const store = {
    lpush: async (k: string, v: string) => {
      const l = [v, ...(fake.lists.get(k) ?? [])];
      fake.lists.set(k, l);
      return l.length;
    },
    ltrim: async (k: string, a: number, b: number) => {
      fake.lists.set(k, (fake.lists.get(k) ?? []).slice(a, b + 1));
      return 'OK';
    },
    // Upstash hands back JSON values already parsed.
    lrange: async (k: string, a: number, b: number) => (fake.lists.get(k) ?? []).slice(a, b + 1).map((v) => JSON.parse(v)),
    sadd: async (k: string, m: string) => fake.sets.set(k, new Set([...(fake.sets.get(k) ?? []), m])),
    srem: async (k: string, m: string) => fake.sets.get(k)?.delete(m),
    smembers: async (k: string) => [...(fake.sets.get(k) ?? [])],
  };
  return { db: () => store, rateLimit: async () => true };
});

import { fileReport, listReports, MAX_REPORTS, resolveReport } from '../server/reports';

const user = { userId: 'u'.repeat(64), email: 'learner@example.com', name: 'Ada Lovelace', tokenHash: 'x' };
const body = (over: Record<string, unknown> = {}) => ({
  kind: 'outline',
  text: '  The outline on this slice covers the liver, not the lesion.  ',
  caseId: 'starter-ct-chest-01',
  taskId: 'starter-ct-chest-01:heart',
  mode: 'practice',
  view: { seriesUid: '1.2.840.1', kind: 'stack', slice: 42, of: 120 },
  ...over,
});

beforeEach(() => {
  fake.lists.clear();
  fake.sets.clear();
});

describe('case reports', () => {
  it('keeps the case, task, slice and sender, newest first', async () => {
    const a = await fileReport(user, body(), new Date('2026-11-04T10:00:00Z'));
    const b = await fileReport(user, body({ kind: 'book', text: '' }), new Date('2026-11-04T11:00:00Z'));
    expect(a.ok && b.ok).toBe(true);
    const { reports, open } = await listReports();
    expect(open).toBe(2);
    expect(reports.map((r) => r.kind)).toEqual(['book', 'outline']);
    expect(reports[1]).toMatchObject({
      text: 'The outline on this slice covers the liver, not the lesion.',
      caseId: 'starter-ct-chest-01',
      taskId: 'starter-ct-chest-01:heart',
      view: { slice: 42, of: 120 },
      email: 'learner@example.com',
      name: 'Ada Lovelace',
      at: '2026-11-04T10:00:00.000Z',
      done: false,
    });
  });

  it('needs words for "something else", and refuses what it cannot read', async () => {
    expect(await fileReport(user, body({ kind: 'other', text: ' ' }))).toEqual({ ok: false, error: 'Please say in a few words what looks wrong.' });
    expect((await fileReport(user, body({ kind: 'other', text: 'The case shows a different patient than the history says.' }))).ok).toBe(true);
    for (const bad of [null, body({ kind: 'spam' }), body({ caseId: '../etc' }), body({ mode: 'admin' }), body({ extra: 1 }), body({ view: { slice: -1 } })])
      expect((await fileReport(user, bad)).ok).toBe(false);
  });

  it('cuts long text and keeps only the newest reports', async () => {
    await fileReport(user, body({ text: 'x'.repeat(1500) }));
    expect((await listReports()).reports[0].text).toHaveLength(1000);
    for (let i = 0; i < MAX_REPORTS + 5; i++) await fileReport(user, body({ text: `report ${i}` }));
    const { reports } = await listReports();
    expect(reports).toHaveLength(MAX_REPORTS);
    expect(reports[0].text).toBe(`report ${MAX_REPORTS + 4}`);
  });

  it('marks a report fixed and opens it again', async () => {
    await fileReport(user, body());
    const [r] = (await listReports()).reports;
    expect(await resolveReport({ id: r.id, done: true })).toEqual({ ok: true });
    expect(await listReports()).toMatchObject({ open: 0, reports: [{ id: r.id, done: true }] });
    await resolveReport({ id: r.id, done: false });
    expect((await listReports()).open).toBe(1);
    expect((await resolveReport({ id: 'x y', done: true })).ok).toBe(false);
  });

  it('accepts every case and task id in the library', async () => {
    const packs = join(__dirname, '..', 'public', 'packs');
    let n = 0;
    for (const d of readdirSync(packs, { withFileTypes: true })) {
      const f = join(packs, d.name, 'lessons.json');
      if (!d.isDirectory() || !existsSync(f)) continue;
      const lessons = JSON.parse(readFileSync(f, 'utf-8')) as { cases: Array<{ id: string }>; tasks: Array<{ id: string; caseId?: string }> };
      for (const t of lessons.tasks) {
        const caseId = t.caseId ?? lessons.cases[0].id;
        const r = await fileReport(user, body({ caseId, taskId: t.id }));
        expect(r.ok, t.id).toBe(true);
        n++;
      }
    }
    expect(n).toBeGreaterThan(1000);
  });
});
