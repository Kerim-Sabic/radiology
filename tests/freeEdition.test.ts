import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeFreeEdition } from '../scripts/build/freeEdition';
import { FREE_EDITION } from '../server/freeEdition.generated';
import { freePathAllowed, weeklyCase } from '../server/free';
import { caseOfWeek, FREE_CASES, freeCaseIds, WEEKLY_CASES, WEEKLY_EPOCH } from '../src/content/weekly';
import { LessonFile, PackManifest } from '../src/schema/content';

const packs = resolve(__dirname, '../public/packs');
const { data, outputs } = computeFreeEdition(packs, { epoch: WEEKLY_EPOCH, always: FREE_CASES, weekly: WEEKLY_CASES });

describe('free edition', () => {
  it('the server allow-list matches the schedule and the packs (run npm run free:sync after changing either)', () => {
    expect(JSON.parse(JSON.stringify(FREE_EDITION))).toEqual(JSON.parse(JSON.stringify(data)));
  });

  it('client and server agree on the case of the week, which starts on Mondays (UTC)', () => {
    for (let d = 0; d < 400; d += 3) {
      const now = new Date(Date.parse(`${WEEKLY_EPOCH}T00:00:00Z`) + d * 86_400_000 + 3_600_000);
      expect(weeklyCase(now)).toBe(caseOfWeek(now).caseId);
    }
    const mon = caseOfWeek(new Date('2026-11-02T00:00:01Z'));
    const sun = caseOfWeek(new Date('2026-11-01T23:59:59Z'));
    expect(mon.caseId).not.toBe(sun.caseId);
    expect(mon.startsAt.toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(freeCaseIds(new Date('2026-10-29T12:00:00Z'))).toEqual(new Set([...FREE_CASES, WEEKLY_CASES[0]]));
  });

  it('a free account reads the samples and this week’s case only', () => {
    const now = new Date('2026-10-29T12:00:00Z'); // week 0
    const sample = FREE_EDITION.cases[FREE_CASES[0]];
    const dicom = `${sample.prefixes[0]}${'a'.repeat(16)}.dcm`;
    expect(freePathAllowed(dicom, now)).toBe(true);
    expect(freePathAllowed(sample.files[0], now)).toBe(true);
    expect(freePathAllowed('/packs/index.free.json', now)).toBe(true);
    expect(freePathAllowed('/content/curriculum.v1.json', now)).toBe(true);
    // This week's case yes, next week's no.
    const thisWeek = FREE_EDITION.cases[WEEKLY_CASES[0]];
    const nextWeek = FREE_EDITION.cases[WEEKLY_CASES[1]];
    expect(freePathAllowed(`${thisWeek.prefixes[0]}x.dcm`, now)).toBe(true);
    expect(freePathAllowed(`${nextWeek.prefixes[0]}x.dcm`, now)).toBe(false);
    expect(freePathAllowed(`${nextWeek.prefixes[0]}x.dcm`, new Date('2026-11-03T12:00:00Z'))).toBe(true);
    // Everything else stays locked: the full index, other patients, path tricks.
    expect(freePathAllowed('/packs/index.json', now)).toBe(false);
    expect(freePathAllowed('/packs/starter/pack.json', now)).toBe(false);
    expect(freePathAllowed('/packs/starter/lessons.json', now)).toBe(false);
    expect(freePathAllowed(`${sample.prefixes[0]}../ct-other/x.dcm`, now)).toBe(false);
    expect(freePathAllowed(`${sample.prefixes[0]}deeper/x.dcm`, now)).toBe(false);
    expect(freePathAllowed(`${sample.prefixes[0]}%2e%2e/x.dcm`, now)).toBe(false);
    expect(freePathAllowed('/packs/teaser.json', now)).toBe(true);
  });

  it('free manifests hold only the free patients and still validate', () => {
    const allowed = new Set([...FREE_CASES, ...WEEKLY_CASES]);
    const lessons = outputs.filter((o) => o.rel.endsWith('lessons.free.json')).map((o) => LessonFile.parse(o.json));
    const caseIds = lessons.flatMap((l) => l.cases.map((c) => c.id));
    expect(new Set(caseIds)).toEqual(allowed);
    expect(lessons.flatMap((l) => l.tasks).every((t) => allowed.has(t.caseId))).toBe(true);
    for (const o of outputs.filter((x) => x.rel.endsWith('pack.free.json'))) PackManifest.parse(o.json);
    // The teaser lists every patient with lessons, by neutral title, and never a diagnosis.
    const teaser = outputs.find((o) => o.rel === 'teaser.json')!.json as { cases: Array<Record<string, unknown>> };
    expect(teaser.cases.length).toBeGreaterThan(90);
    expect(Object.keys(teaser.cases[0]).sort()).toEqual(['id', 'modality', 'region', 'tasks', 'title']);
    expect(teaser.cases.every((c) => /^Patient [A-Z]{1,3} · /.test(String(c.title)))).toBe(true);
  });
});
