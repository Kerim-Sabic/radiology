import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PackManifest, LessonFile } from '../src/schema/content';
import { filterCommercial } from '../scripts/build/commercialContent';

describe('paid-build content', () => {
  it('removes restricted scans, thumbnails, targets and lessons without mutating source packs', () => {
    const pack = PackManifest.parse(JSON.parse(readFileSync('public/packs/more-ct-xr/pack.json', 'utf8')));
    const lessons = LessonFile.parse(JSON.parse(readFileSync('public/packs/more-ct-xr/lessons.json', 'utf8')));
    const excluded = new Set(pack.subjects.filter(s => s.sourceId === 'tcia:MIDRC-RICORD-1C').map(s => s.key));
    expect(excluded.size).toBe(6);
    const result = filterCommercial(pack, lessons, excluded);
    expect(result.pack.subjects.some(s => excluded.has(s.key))).toBe(false);
    expect(result.pack.series.some(s => excluded.has(s.subjectKey))).toBe(false);
    expect(result.lessons?.cases.some(c => excluded.has(c.subjectKey))).toBe(false);
    expect(result.files.filter(f => f.endsWith('.dcm'))).toHaveLength(6);
    expect(result.files.filter(f => f.endsWith('.png'))).toHaveLength(6);
    expect(pack.subjects.filter(s => excluded.has(s.key))).toHaveLength(6);
    expect(result.pack.sources.some(s => /NonCommercial/i.test(s.license))).toBe(false);
  });

  it('keeps tasks a lesson file adds to permitted cases in other packs, and drops those on excluded cases', () => {
    const pack = PackManifest.parse(JSON.parse(readFileSync('public/packs/vessel-drafts/pack.json', 'utf8')));
    const lessons = LessonFile.parse(JSON.parse(readFileSync('public/packs/vessel-drafts/lessons.json', 'utf8')));
    expect(lessons.cases).toHaveLength(0); // every task here belongs to a case defined in another pack
    const kept = filterCommercial(pack, lessons, new Set(), new Set());
    expect(kept.lessons?.tasks).toHaveLength(lessons.tasks.length);
    const one = lessons.tasks[0].caseId;
    const dropped = filterCommercial(pack, lessons, new Set(), new Set([one]));
    expect(dropped.lessons?.tasks.some(t => t.caseId === one)).toBe(false);
    expect(dropped.lessons?.tasks.length).toBe(lessons.tasks.filter(t => t.caseId !== one).length);
  });
});
