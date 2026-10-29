import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeFreeEdition } from '../scripts/build/freeEdition';
import { FREE_EDITION } from '../server/freeEdition.generated';
import { freePathAllowed, weeklyCase } from '../server/free';
import { caseOfWeek, FREE_ANATOMY, FREE_CASES, freeCaseIds, WEEKLY_CASES, WEEKLY_EPOCH } from '../src/content/weekly';
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
    expect(WEEKLY_CASES.length).toBeGreaterThanOrEqual(52); // a year scheduled
    expect(new Set(WEEKLY_CASES).size).toBe(WEEKLY_CASES.length);
  });

  it('a free account reads the sample patients only; the case of the week is for members', () => {
    expect(freeCaseIds()).toEqual(new Set(FREE_CASES));
    expect(WEEKLY_CASES.some((id) => FREE_CASES.includes(id))).toBe(false);
    const sample = FREE_EDITION.cases[FREE_CASES[0]];
    expect(freePathAllowed(`${sample.prefixes[0]}${'a'.repeat(16)}.dcm`)).toBe(true);
    expect(freePathAllowed(sample.files[0])).toBe(true);
    expect(freePathAllowed('/packs/index.free.json')).toBe(true);
    expect(freePathAllowed('/content/curriculum.v1.json')).toBe(true);
    expect(freePathAllowed('/packs/teaser.json')).toBe(true);
    // No case of the week, no other patient, no full index, no path tricks.
    expect(Object.keys(FREE_EDITION.cases).sort()).toEqual([...FREE_CASES].sort());
    expect(freePathAllowed('/packs/pe-cta/dicom/x/y.dcm')).toBe(false);
    expect(freePathAllowed('/packs/index.json')).toBe(false);
    expect(freePathAllowed('/packs/starter/pack.json')).toBe(false);
    expect(freePathAllowed('/packs/starter/lessons.json')).toBe(false);
    expect(freePathAllowed(`${sample.prefixes[0]}../ct-other/x.dcm`)).toBe(false);
    expect(freePathAllowed(`${sample.prefixes[0]}deeper/x.dcm`)).toBe(false);
    expect(freePathAllowed(`${sample.prefixes[0]}%2e%2e/x.dcm`)).toBe(false);
    // The Monday email still knows each weekly case by its neutral title.
    for (const id of WEEKLY_CASES) expect(FREE_EDITION.info[id]?.title, id).toMatch(/^Patient [A-Z]{1,3} · /);
  });

  it('the sample patients keep their task outlines and a few main structures; detailed anatomy is for members', () => {
    const manifests = outputs.filter((o) => o.rel.endsWith('pack.free.json')).map((o) => PackManifest.parse(o.json));
    const free = manifests.flatMap((m) => m.referenceTargets);
    const atlas = free.filter((t) => t.layer === 'atlas');
    expect(atlas.length).toBeGreaterThan(0);
    expect(atlas.length).toBeLessThanOrEqual(FREE_ANATOMY.length);
    for (const t of atlas) expect(FREE_ANATOMY).toContain(t.classId);
    // Task outlines stay, so grading works.
    expect(free.some((t) => t.layer !== 'atlas' && t.classId === 'anatomy:heart')).toBe(true);
    // A detailed structure on the same patient exists in the full pack, and its file is refused.
    const full = PackManifest.parse(JSON.parse(readFileSync(resolve(packs, 'anatomy-atlas/pack.json'), 'utf8')));
    const freeSeries = new Set(free.map((t) => t.seriesUid));
    const rib = full.referenceTargets.find((t) => t.layer === 'atlas' && freeSeries.has(t.seriesUid) && t.classId.startsWith('anatomy:rib_'));
    expect(rib).toBeTruthy();
    expect(freePathAllowed(`/packs/anatomy-atlas/${rib!.geometryFile}`)).toBe(false);
    const heart = full.referenceTargets.find((t) => t.layer === 'atlas' && freeSeries.has(t.seriesUid) && t.classId === 'anatomy:heart');
    if (heart) expect(freePathAllowed(`/packs/anatomy-atlas/${heart.geometryFile}`)).toBe(true);
  });

  it('free manifests hold only the sample patients and still validate', () => {
    const lessons = outputs.filter((o) => o.rel.endsWith('lessons.free.json')).map((o) => LessonFile.parse(o.json));
    expect(new Set(lessons.flatMap((l) => l.cases.map((c) => c.id)))).toEqual(new Set(FREE_CASES));
    expect(lessons.flatMap((l) => l.tasks).every((t) => FREE_CASES.includes(t.caseId))).toBe(true);
    for (const o of outputs.filter((x) => x.rel.endsWith('pack.free.json'))) PackManifest.parse(o.json);
    // The teaser lists every patient with lessons, by neutral title, and never a diagnosis.
    const teaser = outputs.find((o) => o.rel === 'teaser.json')!.json as { cases: Array<Record<string, unknown>> };
    expect(teaser.cases.length).toBeGreaterThan(300);
    expect(Object.keys(teaser.cases[0]).sort()).toEqual(['id', 'modality', 'region', 'tasks', 'title']);
    expect(teaser.cases.every((c) => /^Patient [A-Z]{1,3} · /.test(String(c.title)))).toBe(true);
  });
});
